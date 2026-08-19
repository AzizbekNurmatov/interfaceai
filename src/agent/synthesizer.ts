import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { ZodError } from "zod";
import {
  capabilitySchema as CapabilitySchema,
  CAPABILITY_SCHEMA_VERSION,
  type Capability,
  type Locator,
  type ParameterDef,
  type Step,
  type Target,
} from "../schema/capability.js";
import { ValidationFailure } from "../schema/errors.js";
import type { DiscoveryTrace, TraceEvent } from "./trace.js";

const ERROR_TARGET: Target = {
  description: "In-app error banner",
  primary: { strategy: "css", value: "#tblError" },
  fallbacks: [{ strategy: "xpath", value: "//b[contains(., 'ERROR')]" }],
};

function slug(value: string, fallback: string): string {
  const s = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return s || fallback;
}

function originOf(url: string): string {
  const parsed = new URL(url);
  return `${parsed.protocol}//${parsed.host}`;
}

function toCapabilityUrl(url: string, baseUrl: string): string {
  try {
    const parsed = new URL(url);
    const base = new URL(baseUrl);
    if (parsed.origin === base.origin) {
      return `{baseUrl}${parsed.pathname}${parsed.search}`;
    }
  } catch {
    return url;
  }
  return url;
}

function targetFrom(event: TraceEvent): Target | undefined {
  const primary = event.locators[0];
  if (!primary) return undefined;
  return {
    description: event.description || event.tool,
    primary,
    fallbacks: event.locators.slice(1),
  };
}

function inferParam(event: TraceEvent): { name: string; type: ParameterDef["type"] } | undefined {
  if (event.tool !== "type" || event.typedValue === undefined) return undefined;
  const hint = `${event.paramName ?? ""} ${event.description ?? ""} ${event.inputType ?? ""}`.toLowerCase();
  if (event.inputType === "password" || hint.includes("password") || hint.includes("pwd")) {
    return { name: event.paramName || "password", type: "secret" };
  }
  if (event.isParameter && event.paramName) {
    return { name: event.paramName, type: "string" };
  }
  if (hint.includes("user") || hint.includes("uid") || hint.includes("login")) {
    return { name: event.paramName || "username", type: "string" };
  }
  if (hint.includes("mem") || hint.includes("member") || /^\d{4,}$/.test(event.typedValue)) {
    return { name: event.paramName || "memberId", type: "string" };
  }
  if (event.isParameter) {
    return { name: event.paramName || slug(event.description ?? "value", "inputValue").replace(/-/g, "_"), type: "string" };
  }
  return undefined;
}

function upsertParameter(
  parameters: Map<string, ParameterDef>,
  param: { name: string; type: ParameterDef["type"] },
  event: TraceEvent,
): void {
  const existing = parameters.get(param.name);
  const defaultValue =
    param.name === "username" && event.typedValue ? event.typedValue : existing?.default;
  const hasDefault = defaultValue !== undefined;
  parameters.set(param.name, {
    name: param.name,
    type: param.type,
    required: !hasDefault,
    description: existing?.description ?? `Discovered from field "${event.description ?? param.name}"`,
    maskInLogs: param.type === "secret",
    ...(hasDefault ? { default: defaultValue } : {}),
  });
}

function uniqueLocators(locators: Locator[]): Locator[] {
  const seen = new Set<string>();
  const out: Locator[] = [];
  for (const loc of locators) {
    const key = `${loc.strategy}:${loc.value}:${loc.exact ?? ""}:${loc.nth ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(loc);
  }
  return out;
}

function pathOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

function screenFromTitle(title: string | undefined): string | undefined {
  const part = title?.split(" - ").at(-1)?.trim();
  return part || undefined;
}

function isSameScreen(a?: string, b?: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const na = a.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const nb = b.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (na === nb) return true;
  const logonA = /\blogon\b/.test(na);
  const logonB = /\blogon\b/.test(nb);
  return logonA && logonB;
}

function leftScreen(prev: TraceEvent | undefined): string | undefined {
  return prev?.heading || screenFromTitle(prev?.titleAfter);
}

function xpathLiteral(value: string): string {
  if (!value.includes("'")) return `'${value}'`;
  if (!value.includes('"')) return `"${value}"`;
  return `concat('${value.replace(/'/g, "',\"'\",'")}')`;
}

function cssTextLiteral(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** CSS + text + tag/name locators for a destination heading. */
function landmarkLocators(label: string): Locator[] {
  const css = cssTextLiteral(label);
  const xp = xpathLiteral(label);
  return uniqueLocators([
    { strategy: "text", value: label },
    { strategy: "css", value: `b:has-text("${css}")` },
    { strategy: "xpath", value: `//b[contains(., ${xp})]` },
    { strategy: "css", value: `font:has-text("${css}")` },
    { strategy: "xpath", value: `//font[contains(., ${xp})]` },
  ]);
}

function targetFromLabel(label: string, extra: Locator[] = []): Target {
  const locators = uniqueLocators([...landmarkLocators(label), ...extra]);
  return {
    description: label,
    primary: locators[0]!,
    fallbacks: locators.slice(1),
  };
}

/**
 * Identity of the page AFTER a click/navigate. Never the screen that was just left.
 * Heading recorded on the click itself can still name the old page when the snapshot
 * is taken before navigation settles — look at titleAfter, URL, then later events.
 */
function destinationScreen(
  event: TraceEvent,
  prev: TraceEvent | undefined,
  succeeding: TraceEvent[],
): string | undefined {
  const left = leftScreen(prev);
  const eventPath = pathOf(event.urlAfter);
  const leftPath = pathOf(prev?.urlAfter);
  const navigated = Boolean(leftPath && eventPath && leftPath !== eventPath);

  const prefer = (label?: string): string | undefined =>
    label && !isSameScreen(label, left) ? label : undefined;

  if (navigated) {
    return prefer(screenFromTitle(event.titleAfter)) ?? prefer(event.heading) ?? event.heading ?? screenFromTitle(event.titleAfter);
  }

  const immediate = prefer(screenFromTitle(event.titleAfter)) ?? prefer(event.heading);
  if (immediate) return immediate;

  for (const later of succeeding) {
    if (!later.ok) continue;
    const laterPath = pathOf(later.urlAfter);
    const laterLeft = laterPath && leftPath && laterPath !== leftPath;
    const laterLabel = prefer(later.heading) ?? prefer(screenFromTitle(later.titleAfter));
    if (laterLeft || laterLabel) return laterLabel ?? later.heading ?? screenFromTitle(later.titleAfter);
  }

  return event.heading ?? screenFromTitle(event.titleAfter);
}

function destinationTarget(
  event: TraceEvent,
  prev: TraceEvent | undefined,
  succeeding: TraceEvent[],
): Target | undefined {
  const left = leftScreen(prev);
  const screen = destinationScreen(event, prev, succeeding);
  const destPath = succeeding.find((later) => {
    if (!later.ok) return false;
    const laterPath = pathOf(later.urlAfter);
    const leftPath = pathOf(prev?.urlAfter);
    return Boolean(laterPath && leftPath && laterPath !== leftPath);
  });
  const destPathname = destPath ? pathOf(destPath.urlAfter) : pathOf(event.urlAfter);

  const extra: Locator[] = [];
  const next = succeeding.find((later) => later.ok && later.locators.length > 0 && later.tool !== "finish");
  if (next) {
    const nextScreen = next.heading ?? screenFromTitle(next.titleAfter);
    const nextPath = pathOf(next.urlAfter);
    const onDestination =
      isSameScreen(nextScreen, screen) ||
      Boolean(destPathname && nextPath && nextPath === destPathname);
    if (onDestination && !isSameScreen(nextScreen, left)) {
      extra.push(...next.locators);
      if (next.description) extra.push({ strategy: "text", value: next.description });
    }
  }

  if (screen && !isSameScreen(screen, left)) return targetFromLabel(screen, extra);
  if (extra.length > 0) {
    const locators = uniqueLocators(extra);
    return {
      description: next?.description || event.titleAfter || "destination control",
      primary: locators[0]!,
      fallbacks: locators.slice(1),
    };
  }
  if (screen) return targetFromLabel(screen, extra);
  return undefined;
}

function checkpointFor(
  event: TraceEvent,
  prev: TraceEvent | undefined,
  succeeding: TraceEvent[],
  id: string,
): Step["checkpoint"] | undefined {
  if (event.tool === "type" || event.tool === "extract") return undefined;
  const target = destinationTarget(event, prev, succeeding);
  if (!target) return undefined;
  return {
    id,
    description: `Destination screen after ${event.tool}`,
    assertions: [
      {
        id: `${id}-visible`,
        kind: "visible",
        onMismatch: "hard",
        target,
      },
    ],
  };
}

function collectBusinessFailures(trace: DiscoveryTrace) {
  const seen = new Map<string, string>();
  for (const event of trace.events) {
    const text = event.result;
    if (/LOGON FAILED/i.test(text)) seen.set("INVALID_CREDENTIALS", "Teller logon was rejected.");
    if (/not found/i.test(text)) seen.set("MEMBER_NOT_FOUND", "Member record not found in core database.");
    if (/locked/i.test(text)) seen.set("ACCOUNT_LOCKED", "Account locked due to compliance review.");
    if (/ERROR:/i.test(text) && !seen.has("APPLICATION_ERROR")) {
      seen.set("APPLICATION_ERROR", "Host application displayed an error banner.");
    }
  }
  const failures = [...seen.entries()].map(([code, description]) => ({
    code,
    description,
    target: ERROR_TARGET,
    recoverable: code !== "ACCOUNT_LOCKED",
    messagePattern:
      code === "INVALID_CREDENTIALS"
        ? "LOGON FAILED"
        : code === "MEMBER_NOT_FOUND"
          ? "not found"
          : code === "ACCOUNT_LOCKED"
            ? "locked"
            : "ERROR",
  }));
  if (failures.length === 0) {
    failures.push({
      code: "APPLICATION_ERROR",
      description: "Host application displayed an error banner.",
      target: ERROR_TARGET,
      recoverable: true,
      messagePattern: "ERROR",
    });
  }
  return failures;
}

function originPattern(baseUrl: string): string {
  const { hostname, port } = new URL(baseUrl);
  const escapedHost = hostname.replace(/\./g, "\\.");
  const portPart = port ? `:${port}` : "";
  return `^https?://${escapedHost}${portPart}`;
}

/**
 * Turn a recorded discovery trajectory into a Replay-ready capability artifact.
 */
export function synthesizeCapability(trace: DiscoveryTrace, options?: { id?: string }): Capability {
  const okEvents = trace.events.filter((event) => event.ok && event.tool !== "finish");
  if (okEvents.length === 0) {
    throw new ValidationFailure("Discovery trace has no successful steps to synthesize");
  }

  const baseUrl = originOf(trace.startUrl);
  const parameters = new Map<string, ParameterDef>();
  const steps: Step[] = [];
  const expectedOutputs: Capability["expectedOutputs"] = [];

  for (const [index, event] of okEvents.entries()) {
    const id = `s${String(index + 1).padStart(2, "0")}-${event.tool}`;
    const prev = okEvents[index - 1];
    const succeeding = okEvents.slice(index + 1);
    if (event.tool === "navigate") {
      const url = String(event.input.url ?? trace.startUrl);
      steps.push({
        id,
        name: `Open ${new URL(url, baseUrl).pathname}`,
        action: "navigate",
        url: toCapabilityUrl(url, baseUrl),
        waitAfter: { kind: "loadState", loadState: "domcontentloaded" },
        checkpoint: checkpointFor(event, prev, succeeding, `${id}-cp`),
      });
      continue;
    }

    if (event.tool === "click") {
      const target = targetFrom(event);
      if (!target) continue;
      steps.push({
        id,
        name: event.description ? `Click ${event.description}` : "Click control",
        action: "click",
        target,
        waitAfter: { kind: "loadState", loadState: "domcontentloaded", timeoutMs: 10_000 },
        checkpoint: checkpointFor(event, prev, succeeding, `${id}-cp`),
      });
      continue;
    }

    if (event.tool === "type") {
      const target = targetFrom(event);
      if (!target || event.typedValue === undefined) continue;
      const param = inferParam(event);
      let input: Step["input"];
      if (param) {
        upsertParameter(parameters, param, event);
        input = { source: "parameter", parameter: param.name };
      } else {
        input = { source: "literal", literal: event.typedValue };
      }
      steps.push({
        id,
        name: event.description ? `Enter ${event.description}` : `Enter ${param?.name ?? "value"}`,
        action: "fill",
        target,
        input,
      });
      continue;
    }

    if (event.tool === "waitFor") {
      const text = typeof event.input.text === "string" ? event.input.text : undefined;
      const target = targetFrom(event);
      steps.push({
        id,
        name: text ? `Wait for "${text}"` : "Wait for selector",
        action: "waitFor",
        waitAfter: target
          ? { kind: "selector", target, timeoutMs: 10_000 }
          : text
            ? {
                kind: "selector",
                timeoutMs: 10_000,
                target: {
                  description: text,
                  primary: { strategy: "text", value: text },
                  fallbacks: [],
                },
              }
            : { kind: "loadState", loadState: "domcontentloaded" },
      });
      continue;
    }

    if (event.tool === "extract") {
      const target = targetFrom(event);
      const fieldName = event.fieldName ?? `field${index}`;
      if (!target) continue;
      steps.push({
        id,
        name: `Extract ${fieldName}`,
        action: "extract",
        target,
        extractTo: fieldName,
      });
      expectedOutputs.push({
        name: fieldName,
        type: "string",
        description: event.description || `Extracted ${fieldName}`,
        extract: { method: "innerText", target },
      });
    }
  }

  if (steps.length === 0) {
    throw new ValidationFailure("Synthesizer produced no replayable steps");
  }

  const last = okEvents.at(-1);
  const postconditions =
    expectedOutputs[0]?.extract.target
      ? [
          {
            id: "outputs-visible",
            description: trace.finish?.successCondition || "Expected outputs are visible",
            assertions: [
              {
                id: "primary-output-visible",
                kind: "visible" as const,
                onMismatch: "hard" as const,
                target: expectedOutputs[0].extract.target,
              },
            ],
          },
        ]
      : last?.heading
        ? [
            {
              id: "final-screen",
              description: trace.finish?.successCondition || "Final screen is visible",
              assertions: [
                {
                  id: "final-heading",
                  kind: "visible" as const,
                  onMismatch: "hard" as const,
                  target: targetFromLabel(last.heading),
                },
              ],
            },
          ]
        : [];

  const firstHeading = okEvents[0]?.heading;
  const preconditions = firstHeading
    ? [
        {
          id: "start-screen",
          description: "Expected starting screen after opening the application",
          assertions: [
            {
              id: "start-heading",
              kind: "visible" as const,
              onMismatch: "hard" as const,
              target: targetFromLabel(firstHeading),
            },
          ],
        },
      ]
    : [];

  const draft = {
    schemaVersion: CAPABILITY_SCHEMA_VERSION,
    id: options?.id ?? "discovered-member-inquiry",
    name: trace.finish?.summary?.slice(0, 80) || slug(trace.goal, "discovered-flow"),
    version: "1.0.0",
    description: trace.goal,
    application: {
      name: trace.applicationName || "Legacy application",
      baseUrl,
      originPattern: originPattern(baseUrl),
    },
    parameters: [...parameters.values()],
    expectedOutputs,
    businessFailures: collectBusinessFailures(trace),
    preconditions,
    steps,
    postconditions,
    metadata: {
      discoveredAt: new Date().toISOString(),
      notes: trace.finish?.summary,
    },
  };

  try {
    return CapabilitySchema.parse(draft);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new ValidationFailure(
        "Synthesized capability failed schema validation",
        error.issues.map((issue) => `${issue.path.join(".")} ${issue.message}`),
      );
    }
    throw error;
  }
}

export function saveCapability(path: string, artifact: Capability): void {
  const capability = CapabilitySchema.parse(artifact);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(capability, null, 2)}\n`, "utf8");
}
