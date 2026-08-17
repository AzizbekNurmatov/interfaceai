import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { SafetyViolation } from "../schema/errors.js";
import type { Step } from "../schema/capability.js";

const maskingPatternSchema = z
  .object({
    name: z.string().min(1),
    regex: z.string().min(1),
    replacement: z.string(),
  })
  .strict();

export const guardrailsConfigSchema = z
  .object({
    allowedDomains: z.array(z.string().min(1)).min(1),
    blockedActionKeywords: z.array(z.string().min(1)),
    sensitiveFieldMasking: z
      .object({
        fieldNames: z.array(z.string().min(1)),
        patterns: z.array(maskingPatternSchema),
      })
      .strict(),
  })
  .strict();

export type GuardrailsConfig = z.infer<typeof guardrailsConfigSchema>;

const here = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = join(here, "guardrails.config.json");

function loadConfig(): GuardrailsConfig {
  const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as unknown;
  return guardrailsConfigSchema.parse(raw);
}

function hostPort(url: URL): string {
  if (url.port) return `${url.hostname}:${url.port}`;
  if (url.protocol === "http:") return `${url.hostname}:80`;
  if (url.protocol === "https:") return `${url.hostname}:443`;
  return url.host;
}

export class Guardrails {
  constructor(private readonly config: GuardrailsConfig) {}

  get allowedDomains(): readonly string[] {
    return this.config.allowedDomains;
  }

  assertNavigationAllowed(url: string, stepId?: string): void {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new SafetyViolation("allowedDomains", `Refusing navigation to unparseable URL: ${url}`, {
        stepId,
      });
    }

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new SafetyViolation(
        "allowedDomains",
        `Refusing navigation to protocol ${parsed.protocol} (${url})`,
        { stepId },
      );
    }

    const candidate = hostPort(parsed);
    const allowed = this.config.allowedDomains.some(
      (domain) => domain.toLowerCase() === candidate.toLowerCase(),
    );
    if (!allowed) {
      throw new SafetyViolation(
        "allowedDomains",
        `Refusing navigation to ${candidate}. Allowed: ${this.config.allowedDomains.join(", ")}`,
        { stepId },
      );
    }
  }

  assertStepAllowed(step: Pick<Step, "id" | "name" | "action" | "url">): void {
    const haystack = [step.id, step.name, step.action, step.url ?? ""].join(" ");
    this.assertTextAllowed(haystack, step.id);
  }

  assertTextAllowed(text: string, stepId?: string): void {
    const upper = text.toUpperCase();
    for (const keyword of this.config.blockedActionKeywords) {
      if (upper.includes(keyword.toUpperCase())) {
        throw new SafetyViolation(
          "blockedActionKeywords",
          `Blocked keyword "${keyword}" in "${text}"`,
          { stepId },
        );
      }
    }
  }

  maskText(value: string): string {
    let masked = value;
    for (const pattern of this.config.sensitiveFieldMasking.patterns) {
      masked = masked.replace(new RegExp(pattern.regex, "g"), pattern.replacement);
    }
    return masked;
  }

  maskUnknown(value: unknown, keyHint?: string): unknown {
    if (this.isSensitiveKey(keyHint) && (typeof value === "string" || typeof value === "number")) {
      return "[REDACTED]";
    }
    if (typeof value === "string") return this.maskText(value);
    if (Array.isArray(value)) return value.map((item) => this.maskUnknown(item));
    if (value && typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const [key, nested] of Object.entries(value)) {
        out[key] = this.maskUnknown(nested, key);
      }
      return out;
    }
    return value;
  }

  private isSensitiveKey(key?: string): boolean {
    if (!key) return false;
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    return this.config.sensitiveFieldMasking.fieldNames.some(
      (name) => normalized === name.toLowerCase().replace(/[^a-z0-9]/g, ""),
    );
  }
}

let singleton: Guardrails | undefined;

export function getGuardrails(): Guardrails {
  singleton ??= new Guardrails(loadConfig());
  return singleton;
}

export function loadGuardrailsFromDisk(): Guardrails {
  return new Guardrails(loadConfig());
}
