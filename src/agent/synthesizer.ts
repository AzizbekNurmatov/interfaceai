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

function checkpointFor(event: TraceEvent, id: string): Step["checkpoint"] | undefined {
  if (!event.heading || event.tool === "type" || event.tool === "extract") return undefined;
  return {
    id,
    description: `Still on expected screen after ${event.tool}`,
    assertions: [
      {
        id: `${id}-visible`,
        kind: "visible",
        onMismatch: "hard",
        target: {
          description: event.heading,
          primary: { strategy: "text", value: event.heading },
          fallbacks: [],
        },
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
    if (event.tool === "navigate") {
      const url = String(event.input.url ?? trace.startUrl);
      steps.push({
        id,
        name: `Open ${new URL(url, baseUrl).pathname}`,
        action: "navigate",
        url: toCapabilityUrl(url, baseUrl),
        waitAfter: { kind: "loadState", loadState: "domcontentloaded" },
        checkpoint: checkpointFor(event, `${id}-cp`),
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
        checkpoint: checkpointFor(event, `${id}-cp`),
      });
      continue;
    }

    if (event.tool === "type") {
      const target = targetFrom(event);
      if (!target || event.typedValue === undefined) continue;
      const param = inferParam(event);
      let input: Step["input"];
      if (param) {
        if (!parameters.has(param.name)) {
          parameters.set(param.name, {
            name: param.name,
            type: param.type,
            required: true,
            description: `Discovered from field "${event.description ?? param.name}"`,
            maskInLogs: param.type === "secret",
            ...(param.name === "username" && event.typedValue ? { default: event.typedValue } : {}),
          });
        }
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
                  target: {
                    description: last.heading,
                    primary: { strategy: "text" as const, value: last.heading },
                    fallbacks: [] as Locator[],
                  },
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
              target: {
                description: firstHeading,
                primary: { strategy: "text" as const, value: firstHeading },
                fallbacks: [] as Locator[],
              },
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
