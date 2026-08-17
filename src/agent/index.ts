/**
 * DISCOVERY AGENT — probabilistic, LLM-driven. Phase 3.
 *
 * This module is the ONLY place an LLM may be used (`@anthropic-ai/sdk`).
 * It explores a legacy UI, proposes locators/fallbacks/checkpoints,
 * and writes a capability JSON that the Replay Engine executes with no model.
 *
 * Do not import ReplayEngine for production execution from here.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Capability } from "../schema/capability.js";
import { formatValidationIssues, validateCapability } from "../schema/validate.js";
import { isValidationFailure, ValidationFailure } from "../schema/errors.js";

export interface DiscoveryContext {
  applicationName: string;
  baseUrl: string;
  intent: string;
}

export function saveCapability(path: string, artifact: Capability): void {
  const capability = validateCapability(artifact);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(capability, null, 2)}\n`, "utf8");
}

export async function runDiscovery(_context: DiscoveryContext): Promise<never> {
  throw new ValidationFailure(
    "Discovery is not wired to an LLM yet (Phase 3). Implement exploration here, then call saveCapability().",
    [
      "Keep Playwright exploration and locator proposals in src/agent/",
      "Never call an LLM from src/engine/",
      "The saved JSON must satisfy src/schema/capability.ts",
    ],
  );
}

const isDirect = /agent[/\\]index\.ts$/.test(process.argv[1] ?? "");
if (isDirect) {
  const baseUrl = process.argv[2];
  const intent = process.argv.slice(3).join(" ") || "unspecified intent";
  runDiscovery({
    applicationName: "MemberCore 7.4",
    baseUrl: baseUrl ?? process.env.MOCK_BASE_URL ?? "http://127.0.0.1:3000",
    intent,
  }).catch((error: unknown) => {
    if (isValidationFailure(error)) {
      console.error(formatValidationIssues(error));
      process.exit(1);
    }
    throw error;
  });
}
