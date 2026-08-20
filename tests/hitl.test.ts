import { expect, test } from "@playwright/test";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "../src/engine/cli.js";
import { ReplayEvidence } from "../src/engine/evidence.js";
import {
  classifyInterventionReason,
  requestHumanIntervention,
  type InterventionRequest,
} from "../src/engine/hitl.js";
import { ReplayEngine } from "../src/engine/replay-engine.js";
import { HardFailure } from "../src/schema/errors.js";
import type { Capability, Locator } from "../src/schema/capability.js";
import { loadCapabilityFile } from "../src/schema/validate.js";
import { ACTIVE_MEMBER, MOCK_CREDENTIALS } from "../src/server/members.js";

function loadSample(): Capability {
  return structuredClone(loadCapabilityFile(resolve("capabilities/member-balance-inquiry.json")));
}

const auth = {
  username: MOCK_CREDENTIALS.username,
  password: MOCK_CREDENTIALS.password,
};

function breakUsernameLocator(capability: Capability): { step: NonNullable<Capability["steps"][number]>; original: Locator } {
  const step = capability.steps.find((item) => item.id === "enter-username");
  if (!step?.target) throw new Error("fixture capability missing username step");
  const original = structuredClone(step.target.primary);
  step.target.primary = { strategy: "css", value: "#does-not-exist" };
  step.target.fallbacks = [];
  step.target.timeoutMs = 500;
  return { step, original };
}

function tempLog(): string {
  return join(mkdtempSync(join(tmpdir(), "hitl-")), "replay-run.log");
}

test("classifyInterventionReason maps failure classes", () => {
  expect(
    classifyInterventionReason({
      message: "Could not resolve target",
      failure: new HardFailure("miss", { attemptedLocators: ["css=#x"] }),
    }),
  ).toBe("LOCATOR_FAILURE");
  expect(classifyInterventionReason({ message: "Unexpected alert dialog: Session timeout" })).toBe(
    "UNEXPECTED_DIALOG",
  );
  expect(classifyInterventionReason({ message: "blocked", pageText: "Please complete the CAPTCHA" })).toBe(
    "CAPTCHA_CHALLENGE",
  );
  expect(classifyInterventionReason({ message: "Risky destructive confirmation required" })).toBe(
    "RISKY_ACTION",
  );
  expect(classifyInterventionReason({ message: "something else" })).toBe("UNKNOWN");
});

test("intervention request is populated on locator failure", async ({ page }) => {
  test.setTimeout(30_000);
  const capability = loadSample();
  breakUsernameLocator(capability);
  const logPath = tempLog();
  const evidence = new ReplayEvidence({ path: logPath, truncate: true });

  let captured: InterventionRequest | undefined;
  const engine = new ReplayEngine({
    page,
    capability,
    parameters: { ...auth, memberId: "12345" },
    hitl: true,
    headed: false,
    evidence,
    hitlPrompt: async (request) => {
      captured = request;
      return "abort";
    },
  });

  await expect(engine.run()).rejects.toBeInstanceOf(HardFailure);

  expect(captured).toBeDefined();
  if (!captured) return;
  expect(captured.capabilityId).toBe("member-balance-inquiry");
  expect(captured.stepId).toBe("enter-username");
  expect(captured.reason).toBe("LOCATOR_FAILURE");
  expect(captured.currentUrl).toMatch(/\/login/);
  expect(captured.message).toMatch(/could not resolve target/i);
  expect(captured.screenshotPath).toMatch(/interventions/);
  expect(existsSync(captured.screenshotPath)).toBe(true);

  const log = readFileSync(logPath, "utf8");
  expect(log).toMatch(/hitl_request/);
  expect(log).toMatch(/hitl_intervention/);
  expect(log).toMatch(/enter-username/);
  expect(engine.interventions).toHaveLength(1);
  expect(engine.interventions[0]?.decision).toBe("abort");
});

test("requestHumanIntervention writes a structured request and screenshot", async ({ page }) => {
  await page.goto("/login");
  const result = await requestHumanIntervention(page, {
    capabilityId: "member-balance-inquiry",
    stepId: "enter-username",
    message: "Could not resolve target \"Username\" using 1 locator(s)",
    reason: "LOCATOR_FAILURE",
    headed: false,
    prompt: async () => "abort",
  });

  expect(result.request).toEqual(
    expect.objectContaining({
      capabilityId: "member-balance-inquiry",
      stepId: "enter-username",
      reason: "LOCATOR_FAILURE",
      message: expect.stringContaining("Could not resolve target"),
    }),
  );
  expect(result.request.currentUrl).toMatch(/\/login/);
  expect(result.request.screenshotPath).toMatch(/interventions/);
  expect(existsSync(result.request.screenshotPath)).toBe(true);
  expect(result.decision).toBe("abort");
});

test("engine respects --no-hitl by failing immediately", async ({ page }) => {
  const args = parseArgs([
    "--capability",
    "capabilities/member-balance-inquiry.json",
    "--headless",
    "--no-hitl",
    "--param",
    "password=PASSWORD",
  ]);
  expect(args.hitl).toBe(false);

  const capability = loadSample();
  breakUsernameLocator(capability);

  let prompted = 0;
  const engine = new ReplayEngine({
    page,
    capability,
    parameters: { ...auth, memberId: "12345" },
    hitl: args.hitl,
    headed: args.headed,
    hitlPrompt: async () => {
      prompted += 1;
      return "resume";
    },
  });

  await expect(engine.run()).rejects.toBeInstanceOf(HardFailure);
  expect(prompted).toBe(0);
  expect(engine.interventions).toHaveLength(0);
});

test("resumption after mock human intervention continues remaining steps", async ({ page }) => {
  test.setTimeout(60_000);
  const capability = loadSample();
  const { step, original } = breakUsernameLocator(capability);
  const logPath = tempLog();
  const evidence = new ReplayEvidence({ path: logPath, truncate: true });

  const engine = new ReplayEngine({
    page,
    capability,
    parameters: { ...auth, memberId: "12345" },
    hitl: true,
    headed: false,
    evidence,
    hitlPrompt: async (request) => {
      expect(request.reason).toBe("LOCATOR_FAILURE");
      expect(request.stepId).toBe("enter-username");
      if (!step.target) throw new Error("username target missing");
      step.target.primary = original;
      step.target.timeoutMs = 5_000;
      return "resume";
    },
  });

  const result = await engine.run();
  expect(result.status).toBe("success");
  if (result.status !== "success") return;
  expect(result.outputs.memberName).toBe(ACTIVE_MEMBER.name);
  expect(result.outputs.savingsBalance).toBe(ACTIVE_MEMBER.savingsBalance);
  expect(result.interventions).toHaveLength(1);
  expect(result.interventions[0]?.decision).toBe("resume");
  expect(readFileSync(logPath, "utf8")).toMatch(/hitl_resume_state/);
});
