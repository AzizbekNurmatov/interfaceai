/**
 * DISCOVERY SCRIPT — probabilistic, LLM-driven.
 *
 * This module is the ONLY place an LLM may be used.
 * It explores a legacy UI, proposes locators/fallbacks/checkpoints,
 * and writes a capability JSON that the Replay Engine can execute
 * with no model in the loop.
 *
 * Do not import ReplayEngine for production execution from here.
 * Replay is a separate, deterministic consumer of the artifact.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Capability } from "../types/capability.js";
import { formatValidationIssues, validateCapability } from "../schema/validate.js";
import { isValidationFailure, ValidationFailure } from "../types/errors.js";

export interface DiscoveryContext {
  applicationName: string;
  baseUrl: string;
  intent: string;
}

/**
 * Persist a capability artifact after schema validation.
 * Discovery implementations must call this rather than writing JSON ad hoc.
 */
export function saveCapability(path: string, artifact: Capability): void {
  const capability = validateCapability(artifact);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(capability, null, 2)}\n`, "utf8");
}

export async function runDiscovery(_context: DiscoveryContext): Promise<never> {
  throw new ValidationFailure(
    "Discovery is not wired to an LLM yet. Implement exploration here, then call saveCapability().",
    [
      "Keep Playwright exploration and locator proposals in src/discovery/",
      "Never call an LLM from src/replay/",
      "The saved JSON must satisfy schemas/capability.schema.json",
    ],
  );
}

const isDirect = /discovery[/\\]index\.ts$/.test(process.argv[1] ?? "");
if (isDirect) {
  const baseUrl = process.argv[2];
  const intent = process.argv.slice(3).join(" ") || "unspecified intent";
  runDiscovery({
    applicationName: "unknown",
    baseUrl: baseUrl ?? "https://example.invalid",
    intent,
  }).catch((error: unknown) => {
    if (isValidationFailure(error)) {
      console.error(formatValidationIssues(error));
      process.exit(1);
    }
    throw error;
  });
}
