import { readFileSync } from "node:fs";
import { capabilitySchema, type Capability } from "./capability.js";
import { ValidationFailure } from "./errors.js";

export function loadCapabilityFile(path: string): Capability {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch (cause) {
    throw new ValidationFailure(`Failed to read capability JSON at ${path}`, [
      cause instanceof Error ? cause.message : String(cause),
    ]);
  }
  return validateCapability(raw);
}

export function validateCapability(raw: unknown): Capability {
  const parsed = capabilitySchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => {
      const loc = issue.path.length > 0 ? `/${issue.path.join("/")}` : "/";
      return `${loc} ${issue.message}`.trim();
    });
    throw new ValidationFailure("Capability artifact failed schema validation", issues);
  }
  return parsed.data;
}

export function formatValidationIssues(error: ValidationFailure): string {
  if (error.issues.length === 0) return error.message;
  return `${error.message}:\n${error.issues.map((i) => `  - ${i}`).join("\n")}`;
}
