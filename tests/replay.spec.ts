import { expect, test } from "@playwright/test";
import { resolve } from "node:path";
import { ReplayEngine } from "../src/engine/replay-engine.js";
import { loadCapabilityFile } from "../src/schema/validate.js";
import { HardFailure } from "../src/schema/errors.js";
import type { Capability } from "../src/schema/capability.js";
import { ACTIVE_MEMBER, MOCK_CREDENTIALS } from "../src/server/members.js";

function loadSample(): Capability {
  return structuredClone(loadCapabilityFile(resolve("capabilities/member-balance-inquiry.json")));
}

const auth = {
  username: MOCK_CREDENTIALS.username,
  password: MOCK_CREDENTIALS.password,
};

test("login page is reachable on the mock portal", async ({ page }) => {
  const response = await page.goto("/login");
  expect(response?.ok()).toBeTruthy();
  await expect(page.locator('input[name="txtUID"]')).toBeVisible();
  await expect(page.locator('input[name="btnLogon"]')).toBeVisible();
});

test("replay extracts balances for an active member", async ({ page }) => {
  const engine = new ReplayEngine({
    page,
    capability: loadSample(),
    parameters: { ...auth, memberId: "12345" },
    hitl: false,
  });

  const result = await engine.run();
  expect(result.status).toBe("success");
  if (result.status !== "success") return;
  expect(result.outputs.memberName).toBe(ACTIVE_MEMBER.name);
  expect(result.outputs.savingsBalance).toBe(ACTIVE_MEMBER.savingsBalance);
  expect(result.outputs.checkingBalance).toBe(ACTIVE_MEMBER.checkingBalance);
  expect(result.outputs.accountStatus).toBe("Active");
});

test("unknown member is a BusinessFailure, not HITL", async ({ page }) => {
  const engine = new ReplayEngine({
    page,
    capability: loadSample(),
    parameters: { ...auth, memberId: "99999" },
    hitl: false,
  });

  const result = await engine.run();
  expect(result.status).toBe("business_failure");
  if (result.status !== "business_failure") return;
  expect(result.failure.code).toBe("MEMBER_NOT_FOUND");
  expect(result.failure.recoverable).toBe(true);
});

test("locked member is a BusinessFailure, not HITL", async ({ page }) => {
  const engine = new ReplayEngine({
    page,
    capability: loadSample(),
    parameters: { ...auth, memberId: "LOCKED" },
    hitl: false,
  });

  const result = await engine.run();
  expect(result.status).toBe("business_failure");
  if (result.status !== "business_failure") return;
  expect(result.failure.code).toBe("ACCOUNT_LOCKED");
  expect(result.failure.recoverable).toBe(false);
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
    parameters: { ...auth, memberId: "12345" },
    hitl: false,
  });

  await expect(engine.run()).rejects.toBeInstanceOf(HardFailure);
});
