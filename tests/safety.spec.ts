import { expect, test } from "@playwright/test";
import { getGuardrails } from "../src/safety/guardrails.js";
import { SafetyViolation } from "../src/schema/errors.js";
import { logger } from "../src/utils/logger.js";

test("allows navigation only to localhost:3000", () => {
  const guardrails = getGuardrails();
  expect(() => guardrails.assertNavigationAllowed("http://127.0.0.1:3000/login")).not.toThrow();
  expect(() => guardrails.assertNavigationAllowed("http://localhost:3000/dashboard")).not.toThrow();
  expect(() => guardrails.assertNavigationAllowed("https://bank.example/login")).toThrow(SafetyViolation);
});

test("blocks wire-transfer style actions", () => {
  const guardrails = getGuardrails();
  expect(() =>
    guardrails.assertStepAllowed({
      id: "wire-1",
      name: "Submit WIRE_TRANSFER",
      action: "click",
    }),
  ).toThrow(SafetyViolation);
});

test("redacts SSNs, cards, and password fields from logs", () => {
  const guardrails = getGuardrails();
  expect(guardrails.maskText("SSN 123-45-6789 on file")).toBe("SSN ***-**-**** on file");
  expect(guardrails.maskText("card 4111 1111 1111 1111")).toContain("****-****-****-****");
  expect(guardrails.maskUnknown({ password: "PASSWORD", memberId: "12345" })).toEqual({
    password: "[REDACTED]",
    memberId: "12345",
  });

  const lines: string[] = [];
  const original = console.log;
  console.log = (message?: unknown) => {
    lines.push(String(message));
  };
  try {
    logger.info("auth", { password: "PASSWORD", ssn: "123-45-6789" });
  } finally {
    console.log = original;
  }
  expect(lines.join("\n")).not.toContain("PASSWORD");
  expect(lines.join("\n")).not.toContain("123-45-6789");
});
