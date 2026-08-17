import { expect, test } from "@playwright/test";
import { resolve } from "node:path";
import { loadCapabilityFile, validateCapability } from "../src/schema/validate.js";
import { ValidationFailure } from "../src/types/errors.js";

const SAMPLE = resolve("capabilities/check-account-balance.json");

test("sample capability satisfies the JSON schema", () => {
  const capability = loadCapabilityFile(SAMPLE);
  expect(capability.id).toBe("check-account-balance");
  expect(capability.schemaVersion).toBe("1.0.0");
  expect(capability.steps.length).toBeGreaterThan(0);
  expect(capability.businessFailures.map((f) => f.code)).toContain("ACCOUNT_CLOSED");
});

test("rejects artifacts that omit required contract fields", () => {
  expect(() =>
    validateCapability({
      schemaVersion: "1.0.0",
      id: "broken",
    }),
  ).toThrow(ValidationFailure);
});

test("every step that mutates the page has a target or url", () => {
  const capability = loadCapabilityFile(SAMPLE);
  for (const step of capability.steps) {
    if (step.action === "navigate") {
      expect(step.url, step.id).toBeTruthy();
    } else if (step.action !== "press" && step.action !== "waitFor" && step.action !== "screenshot") {
      expect(step.target, step.id).toBeTruthy();
      expect(step.target?.fallbacks, `${step.id} fallbacks`).toBeDefined();
    }
  }
});
