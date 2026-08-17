import { expect, test } from "@playwright/test";
import { resolve } from "node:path";
import { ReplayEngine } from "../src/replay/engine.js";
import { loadCapabilityFile } from "../src/schema/validate.js";
import { HardFailure } from "../src/types/errors.js";
import type { Capability } from "../src/types/capability.js";

function loadSample(): Capability {
  return structuredClone(loadCapabilityFile(resolve("capabilities/check-account-balance.json")));
}

test("replay extracts balance for an open account", async ({ page }) => {
  const engine = new ReplayEngine({
    page,
    capability: loadSample(),
    parameters: {
      username: "teller",
      password: "password",
      accountNumber: "12345678",
    },
    hitl: false,
  });

  const result = await engine.run();
  expect(result.status).toBe("success");
  if (result.status !== "success") return;
  expect(result.outputs.availableBalance).toBe("$4,250.00");
  expect(result.outputs.accountStatus).toBe("Open");
});

test("closed account is a BusinessFailure, not HITL", async ({ page }) => {
  const engine = new ReplayEngine({
    page,
    capability: loadSample(),
    parameters: {
      username: "teller",
      password: "password",
      accountNumber: "00000000",
    },
    hitl: false,
  });

  const result = await engine.run();
  expect(result.status).toBe("business_failure");
  if (result.status !== "business_failure") return;
  expect(result.failure.code).toBe("ACCOUNT_CLOSED");
  expect(result.failure.recoverable).toBe(false);
  expect(result.failure.observedText).toMatch(/closed/i);
});

test("broken locator is a HardFailure when HITL is disabled", async ({ page }) => {
  const capability = loadSample();
  const usernameStep = capability.steps.find((step) => step.id === "enter-username");
  if (!usernameStep?.target) throw new Error("fixture capability missing username step");
  usernameStep.target.primary = { strategy: "css", value: "#does-not-exist" };
  usernameStep.target.fallbacks = [];
  usernameStep.target.timeoutMs = 500;

  const engine = new ReplayEngine({
    page,
    capability,
    parameters: {
      username: "teller",
      password: "password",
      accountNumber: "12345678",
    },
    hitl: false,
  });

  await expect(engine.run()).rejects.toBeInstanceOf(HardFailure);
});
