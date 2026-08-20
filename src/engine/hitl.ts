import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import type { Page } from "playwright";
import { HardFailure } from "../schema/errors.js";
import { logger } from "../utils/logger.js";
import { captureInterventionScreenshot } from "../utils/screenshots.js";

export type InterventionReason =
  | "LOCATOR_FAILURE"
  | "UNEXPECTED_DIALOG"
  | "RISKY_ACTION"
  | "CAPTCHA_CHALLENGE"
  | "UNKNOWN";

export interface InterventionRequest {
  capabilityId: string;
  stepId: string;
  reason: InterventionReason;
  currentUrl: string;
  screenshotPath: string;
  message: string;
}

export type OperatorDecision = "resume" | "abort" | "skip";

/** @deprecated Use OperatorDecision. "retry" is treated as resume. */
export type HitlDecision = "retry" | "skip" | "abort";

export type OperatorPrompt = (request: InterventionRequest) => Promise<OperatorDecision>;

export interface HitlEvidenceWriter {
  record(event: string, data?: unknown): void;
}

export interface InterventionContext {
  capabilityId: string;
  stepId: string;
  message: string;
  reason?: InterventionReason;
  failure?: HardFailure;
  headed?: boolean;
  /** Opens Playwright Inspector. Off by default — it blocks until the operator resumes. */
  pauseInspector?: boolean;
  prompt?: OperatorPrompt;
  evidence?: HitlEvidenceWriter;
}

export interface HitlHandoffResult {
  request: InterventionRequest;
  decision: OperatorDecision;
}

export interface PageStateSnapshot {
  url: string;
  title: string;
  closed: boolean;
}

const CAPTCHA_RE = /captcha|recaptcha|h-?captcha|i['’]?m not a robot|are you a robot/;
const DIALOG_RE = /\b(unexpected\s+)?(dialog|alert|confirm|prompt)\b/;
const RISKY_RE = /risky|destructive|irreversible|wire_transfer/;
const LOCATOR_RE = /could not resolve target|locator|timeout.*selector|waiting for locator/;

export function classifyInterventionReason(input: {
  message: string;
  failure?: HardFailure;
  pageText?: string;
}): InterventionReason {
  const haystack = [
    input.message,
    input.failure?.message,
    input.failure?.locatorDescription,
    ...(input.failure?.attemptedLocators ?? []),
    input.pageText ?? "",
  ]
    .filter((part): part is string => Boolean(part))
    .join(" ")
    .toLowerCase();

  if (CAPTCHA_RE.test(haystack)) return "CAPTCHA_CHALLENGE";
  if (DIALOG_RE.test(haystack)) return "UNEXPECTED_DIALOG";
  if (RISKY_RE.test(haystack)) return "RISKY_ACTION";
  if (input.failure?.attemptedLocators && input.failure.attemptedLocators.length > 0) {
    return "LOCATOR_FAILURE";
  }
  if (LOCATOR_RE.test(haystack)) return "LOCATOR_FAILURE";
  return "UNKNOWN";
}

/**
 * HITL needs a live operator, an injected prompt (tests), or it must fail closed.
 * `--no-hitl` / CI / non-TTY never block on readline.
 */
export function canPromptOperator(prompt?: OperatorPrompt): boolean {
  if (prompt) return true;
  if (process.env.CI === "true" || process.env.CI === "1") return false;
  return Boolean(input.isTTY);
}

export async function capturePageState(page: Page): Promise<PageStateSnapshot> {
  if (page.isClosed()) {
    return { url: "", title: "", closed: true };
  }
  return {
    url: page.url(),
    title: await page.title().catch(() => ""),
    closed: false,
  };
}

function printHandoffBanner(request: InterventionRequest, headed: boolean): void {
  const session = headed
    ? "LIVE — the current Playwright page is still open. Perform manual actions in that window, then choose R/A/S."
    : "HEADLESS — the live page is still active but not visible. Inspect the screenshot, or re-run with --headed for on-screen control.";

  const lines = [
    "",
    "========== HITL INTERVENTION ==========",
    "Automation paused. Control of the live browser session is handed to the operator.",
    `  capability : ${request.capabilityId}`,
    `  step       : ${request.stepId}`,
    `  reason     : ${request.reason}`,
    `  url        : ${request.currentUrl}`,
    `  screenshot : ${request.screenshotPath}`,
    `  message    : ${request.message}`,
    `  session    : ${session}`,
    "",
    "[R] Resume automation from current state",
    "[A] Abort execution and record failure",
    "[S] Skip failed step and continue",
    "=======================================",
    "",
  ];
  console.error(lines.join("\n"));
}

async function promptOperatorCli(): Promise<OperatorDecision> {
  const rl = readline.createInterface({ input, output });
  try {
    for (;;) {
      const answer = (await rl.question("HITL> ")).trim().toLowerCase();
      if (answer === "r" || answer === "resume") return "resume";
      if (answer === "a" || answer === "abort") return "abort";
      if (answer === "s" || answer === "skip") return "skip";
      console.error("Please enter R, A, or S.");
    }
  } finally {
    rl.close();
  }
}

async function readPageText(page: Page): Promise<string> {
  if (page.isClosed()) return "";
  return await page
    .locator("body")
    .innerText({ timeout: 1_000 })
    .catch(() => "");
}

/**
 * Halt the automation loop, keep the current Playwright page, and route a
 * structured intervention request to the operator.
 */
export async function requestHumanIntervention(
  page: Page,
  context: InterventionContext,
): Promise<HitlHandoffResult> {
  const state = await capturePageState(page);
  const pageText = await readPageText(page);
  const screenshotPath = await captureInterventionScreenshot(page, context.stepId);
  const reason =
    context.reason ??
    classifyInterventionReason({
      message: context.message,
      failure: context.failure,
      pageText,
    });

  const request: InterventionRequest = {
    capabilityId: context.capabilityId,
    stepId: context.stepId,
    reason,
    currentUrl: state.url || (page.isClosed() ? "" : page.url()),
    screenshotPath,
    message: context.message,
  };

  context.evidence?.record("hitl_request", request);
  logger.error("hitl intervention requested", request);
  printHandoffBanner(request, context.headed ?? false);

  if (context.pauseInspector && !page.isClosed()) {
    console.error("Playwright inspector pausing. Resume the inspector, then answer R/A/S.\n");
    await page.pause();
  }

  let decision: OperatorDecision;
  if (context.prompt) {
    decision = await context.prompt(request);
  } else if (!canPromptOperator()) {
    throw new HardFailure(
      "HITL required but this process is non-interactive. Re-run with --headed for a live window, or pass --no-hitl in CI.",
      { stepId: context.stepId, cause: context.failure },
    );
  } else {
    decision = await promptOperatorCli();
  }

  context.evidence?.record("hitl_decision", {
    stepId: request.stepId,
    reason: request.reason,
    decision,
    url: request.currentUrl,
    screenshotPath: request.screenshotPath,
  });
  logger.info("hitl decision", { stepId: request.stepId, decision, reason: request.reason });

  return { request, decision };
}

/**
 * Mock Human-In-The-Loop handoff (compat wrapper).
 * Discovery (LLM) is never consulted.
 */
export async function handoffToHuman(
  page: Page,
  failure: HardFailure,
  context?: Omit<InterventionContext, "message" | "failure">,
): Promise<HitlDecision> {
  const result = await requestHumanIntervention(page, {
    capabilityId: context?.capabilityId ?? "unknown",
    stepId: failure.stepId ?? context?.stepId ?? "unknown",
    message: failure.message,
    failure,
    headed: context?.headed,
    pauseInspector: context?.pauseInspector,
    prompt: context?.prompt,
    evidence: context?.evidence,
  });
  if (result.decision === "resume") return "retry";
  return result.decision;
}
