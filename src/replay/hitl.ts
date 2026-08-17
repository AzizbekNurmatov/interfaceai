import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import type { Page } from "playwright";
import type { HardFailure } from "../types/errors.js";

export type HitlDecision = "retry" | "skip" | "abort";

/**
 * Mock Human-In-The-Loop handoff.
 *
 * 1. Playwright `page.pause()` opens the inspector so an operator can
 *    inspect / manually click / fix the page.
 * 2. After the operator resumes, a CLI prompt records the control decision.
 *
 * Discovery (LLM) is never consulted here.
 */
export async function handoffToHuman(page: Page, failure: HardFailure): Promise<HitlDecision> {
  const lines = [
    "",
    "========== HITL HANDOFF ==========",
    "HARD FAILURE — automation contract broke. Not a business outcome.",
    `  message : ${failure.message}`,
    failure.stepId ? `  step    : ${failure.stepId}` : "",
    failure.locatorDescription ? `  target  : ${failure.locatorDescription}` : "",
    failure.attemptedLocators?.length
      ? `  tried   : ${failure.attemptedLocators.join(" | ")}`
      : "",
    "",
    "Playwright inspector is pausing. Inspect the page, then resume.",
    "After resume you will be prompted: retry / skip / abort.",
    "==================================",
    "",
  ].filter((line) => line !== undefined);

  console.error(lines.join("\n"));

  await page.pause();

  const rl = readline.createInterface({ input, output });
  try {
    for (;;) {
      const answer = (await rl.question("HITL decision [r]etry / [s]kip / [a]bort: "))
        .trim()
        .toLowerCase();
      if (answer === "r" || answer === "retry") return "retry";
      if (answer === "s" || answer === "skip") return "skip";
      if (answer === "a" || answer === "abort") return "abort";
      console.error("Please enter r, s, or a.");
    }
  } finally {
    rl.close();
  }
}
