import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runDiscoveryLoop } from "../src/agent/discover.js";
import { ScriptedLlmClient } from "../src/agent/llm.js";
import { ReplayEngine } from "../src/engine/replay-engine.js";
import { MOCK_CREDENTIALS } from "../src/server/members.js";

const goal = "Log in as TELLER01 and lookup member 12345 savings balance";

function scriptedInquiryClient(): ScriptedLlmClient {
  return new ScriptedLlmClient([
    [
      {
        name: "click",
        input: { selector: "#does-not-exist", element_description: "missing" },
      },
    ],
    [
      {
        name: "type",
        input: {
          selector: "input[name='txtUID']",
          value: "TELLER01",
          isParameter: true,
          paramName: "username",
        },
      },
    ],
    [
      {
        name: "type",
        input: {
          selector: "input[name='txtPWD']",
          value: "PASSWORD",
          isParameter: true,
          paramName: "password",
        },
      },
    ],
    [{ name: "click", input: { selector: "input[name='btnLogon']" } }],
    [{ name: "click", input: { element_description: "Member Search" } }],
    [
      {
        name: "type",
        input: {
          selector: "input[name='memID']",
          value: "12345",
          isParameter: true,
          paramName: "memberId",
        },
      },
    ],
    [{ name: "click", input: { selector: "input[name='btnSearch']" } }],
    [
      {
        name: "extract",
        input: {
          selector: '//td[contains(., "Savings Balance")]/following-sibling::td[1]',
          fieldName: "savingsBalance",
        },
      },
    ],
    [
      {
        name: "finish",
        input: {
          summary: "Looked up member savings balance",
          successCondition: "Savings Balance is visible",
        },
      },
    ],
  ]);
}

test("scripted discovery synthesizes a replayable capability", async ({ page }) => {
  test.setTimeout(60_000);
  const artifactPath = join(tmpdir(), `discovered-member-inquiry-${Date.now()}.json`);
  mkdirSync(tmpdir(), { recursive: true });

  const result = await runDiscoveryLoop({
    page,
    goal,
    startUrl: "http://127.0.0.1:3000/login",
    artifactPath,
    capabilityId: "discovered-member-inquiry",
    llm: scriptedInquiryClient(),
    applicationName: "MemberCore 7.4",
  });

  expect(result.capability.id).toBe("discovered-member-inquiry");
  expect(result.capability.parameters.map((p) => p.name)).toEqual(
    expect.arrayContaining(["username", "password", "memberId"]),
  );
  expect(result.capability.expectedOutputs[0]?.name).toBe("savingsBalance");
  expect(result.trace.events.some((e) => !e.ok && e.tool === "click")).toBe(true);

  const replayContext = await page.context().browser()!.newContext();
  const replayPage = await replayContext.newPage();
  try {
    const engine = new ReplayEngine({
      page: replayPage,
      capability: result.capability,
      parameters: {
        username: MOCK_CREDENTIALS.username,
        password: MOCK_CREDENTIALS.password,
        memberId: "12345",
      },
      hitl: false,
    });
    const replayed = await engine.run();
    expect(replayed.status).toBe("success");
    if (replayed.status === "success") {
      expect(replayed.outputs.savingsBalance).toBe("$14,250.00");
    }
  } finally {
    await replayContext.close();
  }
});
