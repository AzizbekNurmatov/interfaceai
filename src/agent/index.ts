/**
 * DISCOVERY AGENT — probabilistic, LLM-driven.
 *
 * This module is the ONLY place an LLM may be used (`@anthropic-ai/sdk`).
 * Replay (src/engine) must never import this loop for production execution.
 */

import "dotenv/config";
import { chromium } from "playwright";
import { ValidationFailure, formatValidationIssues, isValidationFailure, isSafetyViolation } from "../schema/index.js";
import { DiscoveryEvidence, DISCOVERY_SCREENSHOT_PATH } from "./evidence.js";
import { runDiscoveryLoop } from "./discover.js";

export { saveCapability } from "./synthesizer.js";
export { runDiscoveryLoop, DiscoveryLoop } from "./discover.js";
export { observePage, formatSnapshotForLlm } from "./observer.js";
export { synthesizeCapability } from "./synthesizer.js";
export { ScriptedLlmClient, AnthropicLlmClient } from "./llm.js";

export interface DiscoveryCliArgs {
  goal: string;
  url: string;
  headed: boolean;
  out: string;
  maxSteps?: number;
}

export function parseDiscoverArgs(argv: string[]): DiscoveryCliArgs {
  let goal: string | undefined;
  let url: string | undefined;
  let headed = false;
  let out = "capabilities/discovered-member-inquiry.json";
  let maxSteps: number | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--goal") goal = argv[++i];
    else if (arg === "--url") url = argv[++i];
    else if (arg === "--headed") headed = true;
    else if (arg === "--headless") headed = false;
    else if (arg === "--out") out = argv[++i] ?? out;
    else if (arg === "--max-steps") maxSteps = Number(argv[++i]);
    else if (arg?.startsWith("-")) {
      throw new ValidationFailure(`Unknown flag: ${arg}`);
    }
  }

  if (!goal) throw new ValidationFailure("Missing --goal <text>");
  if (!url) throw new ValidationFailure("Missing --url <http url>");
  return { goal, url, headed, out, maxSteps };
}

export async function runDiscoveryCli(argv = process.argv.slice(2)): Promise<number> {
  const args = parseDiscoverArgs(argv);
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new ValidationFailure("ANTHROPIC_API_KEY is required for discovery", [
      "Set it in .env — Replay (src/engine) never reads this key",
    ]);
  }

  const evidence = new DiscoveryEvidence();
  const browser = await chromium.launch({ headless: !args.headed });
  const page = await browser.newPage();
  try {
    const result = await runDiscoveryLoop({
      page,
      goal: args.goal,
      startUrl: args.url,
      artifactPath: args.out,
      capabilityId: "discovered-member-inquiry",
      evidence,
      maxSteps: args.maxSteps,
    });
    await page.screenshot({ path: DISCOVERY_SCREENSHOT_PATH, fullPage: true });
    evidence.record("final_screenshot", { path: DISCOVERY_SCREENSHOT_PATH });
    console.log(
      JSON.stringify(
        {
          status: "discovered",
          artifact: result.artifactPath,
          steps: result.capability.steps.length,
          parameters: result.capability.parameters.map((p) => p.name),
          outputs: result.capability.expectedOutputs.map((o) => o.name),
          log: evidence.path,
          screenshot: DISCOVERY_SCREENSHOT_PATH,
        },
        null,
        2,
      ),
    );
    return 0;
  } finally {
    await page.context().close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}

const isDirect = /agent[/\\]index\.ts$/.test(process.argv[1] ?? "");
if (isDirect) {
  runDiscoveryCli().then(
    (code) => process.exit(code),
    (error: unknown) => {
      if (isValidationFailure(error)) {
        console.error(formatValidationIssues(error));
        process.exit(1);
      }
      if (isSafetyViolation(error)) {
        console.error(JSON.stringify({ status: "safety_violation", rule: error.rule, message: error.message }, null, 2));
        process.exit(4);
      }
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    },
  );
}
