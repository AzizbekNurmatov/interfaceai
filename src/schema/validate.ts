import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
import type { Capability } from "../types/capability.js";
import { ValidationFailure } from "../types/errors.js";

type FormatsPlugin = (ajv: Ajv2020) => unknown;
const addFormats: FormatsPlugin =
  typeof addFormatsModule === "function"
    ? (addFormatsModule as FormatsPlugin)
    : (addFormatsModule as unknown as { default: FormatsPlugin }).default;

const here = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = join(here, "../../schemas/capability.schema.json");

let validator: ValidateFunction | undefined;

function getValidator(): ValidateFunction {
  if (!validator) {
    const ajv = new Ajv2020({
      allErrors: true,
      strict: true,
      strictRequired: false,
      allowUnionTypes: true,
    });
    addFormats(ajv);
    const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8")) as object;
    validator = ajv.compile(schema);
  }
  return validator;
}

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
  const validate = getValidator();
  const ok = validate(raw);
  if (!ok) {
    const issues = (validate.errors ?? []).map((err: ErrorObject) => {
      const loc = err.instancePath || "/";
      return `${loc} ${err.message ?? "invalid"}`.trim();
    });
    throw new ValidationFailure("Capability artifact failed schema validation", issues);
  }
  return raw as Capability;
}

export function formatValidationIssues(error: ValidationFailure): string {
  if (error.issues.length === 0) return error.message;
  return `${error.message}:\n${error.issues.map((i) => `  - ${i}`).join("\n")}`;
}
