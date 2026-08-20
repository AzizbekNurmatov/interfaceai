import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Page } from "playwright";
import type {
  Assertion,
  Capability,
  Checkpoint,
  OutputValues,
  ParameterValues,
  Step,
  StepInput,
  Target,
  WaitSpec,
} from "../schema/capability.js";
import {
  BusinessFailure,
  HardFailure,
  SafetyViolation,
  ValidationFailure,
} from "../schema/errors.js";
import { getGuardrails } from "../safety/guardrails.js";
import { captureEvidence } from "../utils/screenshots.js";
import { ReplayEvidence, type InterventionRecord } from "./evidence.js";
import {
  canPromptOperator,
  requestHumanIntervention,
  type OperatorPrompt,
} from "./hitl.js";
import { describeLocator, isTargetVisible, resolveTarget } from "./locators.js";

export interface ReplayOptions {
  page: Page;
  capability: Capability;
  parameters: ParameterValues;
  /**
   * When true (default in CLI), HardFailure pauses the live session and prompts.
   * Tests should set this to false, or inject `hitlPrompt`, rather than hang on stdin.
   */
  hitl?: boolean;
  /** True when the browser window is visible so the operator can take over. */
  headed?: boolean;
  /** Injected operator. Used by tests to mock R/A/S without readline. */
  hitlPrompt?: OperatorPrompt;
  pauseInspector?: boolean;
  evidence?: ReplayEvidence;
}

export interface ReplaySuccess {
  status: "success";
  outputs: OutputValues;
  interventions: InterventionRecord[];
}

export interface ReplayBusinessResult {
  status: "business_failure";
  failure: BusinessFailure;
  outputs: OutputValues;
  interventions: InterventionRecord[];
}

export type ReplayResult = ReplaySuccess | ReplayBusinessResult;

const MAX_HITL_RETRIES = 3;

export class ReplayEngine {
  private readonly page: Page;
  private readonly capability: Capability;
  private readonly parameters: ParameterValues;
  private readonly hitl: boolean;
  private readonly headed: boolean;
  private readonly hitlPrompt?: OperatorPrompt;
  private readonly pauseInspector: boolean;
  private readonly evidence: ReplayEvidence;
  private readonly outputs: OutputValues = {};
  private unexpectedDialog: { type: string; message: string } | undefined;
  private dialogHookInstalled = false;

  constructor(options: ReplayOptions) {
    this.page = options.page;
    this.capability = options.capability;
    this.parameters = options.parameters;
    this.hitl = options.hitl ?? true;
    this.headed = options.headed ?? false;
    this.hitlPrompt = options.hitlPrompt;
    this.pauseInspector = options.pauseInspector ?? process.env.HITL_PAUSE_INSPECTOR === "1";
    this.evidence = options.evidence ?? new ReplayEvidence({ truncate: false });
  }

  get interventions(): InterventionRecord[] {
    return this.evidence.interventions;
  }

  async run(): Promise<ReplayResult> {
    this.assertParameters();
    this.installDialogHook();
    this.evidence.record("replay_start", {
      capabilityId: this.capability.id,
      hitl: this.hitl,
      headed: this.headed,
    });

    try {
      const steps = this.capability.steps;
      let start = 0;
      if (steps[0]?.action === "navigate") {
        await this.runStepWithHitl(steps[0]);
        start = 1;
      } else {
        const url = toGotoUrl(this.interpolate("{baseUrl}"));
        getGuardrails().assertNavigationAllowed(url);
        await this.page.goto(url, { waitUntil: "domcontentloaded" });
      }

      await this.runCheckpoints(this.capability.preconditions, "precondition");
      const landingFailure = await this.detectBusinessFailure("precondition");
      if (landingFailure) {
        this.evidence.record("business_failure", {
          code: landingFailure.code,
          stepId: landingFailure.stepId,
        });
        return {
          status: "business_failure",
          failure: landingFailure,
          outputs: { ...this.outputs },
          interventions: [...this.evidence.interventions],
        };
      }

      for (const step of steps.slice(start)) {
        await this.runStepWithHitl(step);
      }

      await this.extractDeclaredOutputs();
      await this.runCheckpoints(this.capability.postconditions, "postcondition");

      this.evidence.record("replay_success", { outputs: this.outputs });
      return {
        status: "success",
        outputs: { ...this.outputs },
        interventions: [...this.evidence.interventions],
      };
    } catch (error) {
      if (error instanceof BusinessFailure) {
        this.evidence.record("business_failure", {
          code: error.code,
          stepId: error.stepId,
        });
        return {
          status: "business_failure",
          failure: error,
          outputs: { ...this.outputs },
          interventions: [...this.evidence.interventions],
        };
      }
      if (error instanceof HardFailure) {
        this.evidence.record("hard_failure", {
          message: error.message,
          stepId: error.stepId,
          locatorDescription: error.locatorDescription,
          attemptedLocators: error.attemptedLocators,
        });
      }
      throw error;
    }
  }

  private assertParameters(): void {
    const issues: string[] = [];
    for (const def of this.capability.parameters) {
      const value = this.parameters[def.name];
      if (value === undefined || value === "") {
        if (def.required && def.default === undefined) {
          issues.push(`Missing required parameter "${def.name}"`);
        }
        continue;
      }
      if (def.type === "enum" && def.enumValues && !def.enumValues.includes(String(value))) {
        issues.push(`Parameter "${def.name}" must be one of: ${def.enumValues.join(", ")}`);
      }
    }
    if (issues.length > 0) {
      throw new ValidationFailure("Replay parameters are invalid", issues);
    }
  }

  private installDialogHook(): void {
    if (this.dialogHookInstalled) return;
    this.dialogHookInstalled = true;
    this.page.on("dialog", (dialog) => {
      this.unexpectedDialog = { type: dialog.type(), message: dialog.message() };
      void dialog.dismiss().catch(() => undefined);
    });
  }

  private consumeUnexpectedDialog(stepId: string): void {
    const dialog = this.unexpectedDialog;
    if (!dialog) return;
    this.unexpectedDialog = undefined;
    throw new HardFailure(`Unexpected ${dialog.type} dialog: ${dialog.message}`, { stepId });
  }

  private async runStepWithHitl(step: Step): Promise<void> {
    let attempts = 0;
    for (;;) {
      try {
        this.evidence.record("step_start", { stepId: step.id, action: step.action });
        await this.executeStep(step);
        this.consumeUnexpectedDialog(step.id);
        const business = await this.detectBusinessFailure(step.id);
        if (business) throw business;
        if (step.waitAfter) {
          await this.wait(step.waitAfter, step.id);
        }
        if (step.checkpoint) {
          await this.runCheckpoint(step.checkpoint);
        }
        this.evidence.record("step_ok", { stepId: step.id });
        return;
      } catch (error) {
        if (error instanceof BusinessFailure || error instanceof SafetyViolation) throw error;
        const hard =
          error instanceof HardFailure
            ? error
            : new HardFailure(error instanceof Error ? error.message : String(error), {
                stepId: step.id,
                cause: error,
              });

        this.evidence.record("step_fail", {
          stepId: step.id,
          message: hard.message,
          locatorDescription: hard.locatorDescription,
          attemptedLocators: hard.attemptedLocators,
        });

        if (!this.hitl) throw hard;
        if (!canPromptOperator(this.hitlPrompt)) {
          throw new HardFailure(
            "HITL required but this process is non-interactive. Pass --no-hitl in CI.",
            { stepId: step.id, cause: hard },
          );
        }

        attempts += 1;
        if (attempts > MAX_HITL_RETRIES) {
          throw new HardFailure(`HITL retry limit exceeded for step ${step.id}`, {
            stepId: step.id,
            cause: hard,
          });
        }

        const handoff = await requestHumanIntervention(this.page, {
          capabilityId: this.capability.id,
          stepId: step.id,
          message: hard.message,
          failure: hard,
          headed: this.headed,
          pauseInspector: this.pauseInspector,
          prompt: this.hitlPrompt,
          evidence: this.evidence,
        });
        this.evidence.recordIntervention(handoff.request, handoff.decision);

        if (handoff.decision === "abort") throw hard;
        if (handoff.decision === "skip") {
          this.evidence.record("hitl_skip", { stepId: step.id, optional: Boolean(step.optional) });
          return;
        }

        const state = await this.verifyPageStateAfterHandoff(step);
        if (state === "step-satisfied") return;
      }
    }
  }

  /**
   * After the operator presses R: keep the live page, confirm it is still
   * usable, and re-evaluate the step checkpoint. If the human already completed
   * the step, skip re-issuing the action.
   */
  private async verifyPageStateAfterHandoff(step: Step): Promise<"step-satisfied" | "retry"> {
    if (this.page.isClosed()) {
      throw new HardFailure("HITL resume failed: the live page was closed", { stepId: step.id });
    }
    getGuardrails().assertNavigationAllowed(this.page.url(), step.id);
    this.evidence.record("hitl_resume_state", {
      stepId: step.id,
      url: this.page.url(),
    });

    if (!step.checkpoint) return "retry";
    try {
      await this.runCheckpoint(step.checkpoint);
      this.evidence.record("hitl_checkpoint_satisfied", {
        stepId: step.id,
        checkpointId: step.checkpoint.id,
      });
      return "step-satisfied";
    } catch (error) {
      if (error instanceof BusinessFailure || error instanceof SafetyViolation) throw error;
      this.evidence.record("hitl_checkpoint_unsatisfied", {
        stepId: step.id,
        message: error instanceof Error ? error.message : String(error),
      });
      return "retry";
    }
  }

  private async executeStep(step: Step): Promise<void> {
    getGuardrails().assertStepAllowed(step);

    switch (step.action) {
      case "navigate": {
        if (!step.url) {
          throw new HardFailure("navigate step is missing url", { stepId: step.id });
        }
        const url = toGotoUrl(this.interpolate(step.url));
        getGuardrails().assertNavigationAllowed(url, step.id);
        await this.page.goto(url, { waitUntil: "domcontentloaded" });
        this.assertOrigin(step.id);
        return;
      }
      case "click":
      case "dblclick":
      case "hover":
      case "check":
      case "uncheck":
      case "assertVisible": {
        const resolved = await this.requireTarget(step);
        if (!resolved) return;
        if (step.action === "click") await resolved.locator.click();
        else if (step.action === "dblclick") await resolved.locator.dblclick();
        else if (step.action === "hover") await resolved.locator.hover();
        else if (step.action === "check") await resolved.locator.check();
        else if (step.action === "uncheck") await resolved.locator.uncheck();
        return;
      }
      case "assertHidden": {
        if (!step.target) {
          throw new HardFailure("assertHidden step is missing target", { stepId: step.id });
        }
        const visible = await isTargetVisible(this.page, step.target);
        if (visible) {
          throw new HardFailure(`Expected "${step.target.description}" to be hidden`, {
            stepId: step.id,
            locatorDescription: step.target.description,
          });
        }
        return;
      }
      case "fill":
      case "type":
      case "select":
      case "assertText": {
        const resolved = await this.requireTarget(step);
        if (!resolved) return;
        const value = String(this.resolveInput(step.input, step.id));
        if (step.action === "fill") await resolved.locator.fill(value);
        else if (step.action === "type") await resolved.locator.pressSequentially(value);
        else if (step.action === "select") await resolved.locator.selectOption({ label: value });
        else {
          const text = await resolved.locator.innerText();
          if (!text.includes(value)) {
            throw new HardFailure(
              `Expected "${step.target?.description}" to contain "${value}", got "${text}"`,
              { stepId: step.id, locatorDescription: step.target?.description },
            );
          }
        }
        return;
      }
      case "press": {
        if (!step.key) {
          throw new HardFailure("press step is missing key", { stepId: step.id });
        }
        if (step.target) {
          const resolved = await this.requireTarget(step);
          if (!resolved) return;
          await resolved.locator.press(step.key);
        } else {
          await this.page.keyboard.press(step.key);
        }
        return;
      }
      case "waitFor": {
        if (!step.waitAfter) {
          throw new HardFailure("waitFor step is missing waitAfter", { stepId: step.id });
        }
        await this.wait(step.waitAfter, step.id);
        return;
      }
      case "extract": {
        if (!step.extractTo) {
          throw new HardFailure("extract step is missing extractTo", { stepId: step.id });
        }
        const resolved = await this.requireTarget(step);
        if (!resolved) return;
        this.outputs[step.extractTo] = (await resolved.locator.innerText()).trim();
        return;
      }
      case "screenshot": {
        await captureEvidence(this.page, `replay-${step.id}`);
        return;
      }
      default: {
        const exhaustive: never = step.action;
        throw new HardFailure(`Unsupported action: ${String(exhaustive)}`, { stepId: step.id });
      }
    }
  }

  private async requireTarget(step: Step) {
    if (!step.target) {
      throw new HardFailure(`Step "${step.id}" (${step.action}) is missing target`, {
        stepId: step.id,
      });
    }
    try {
      return await resolveTarget(this.page, step.target, step.id);
    } catch (error) {
      if (error instanceof HardFailure && step.optional) {
        return undefined;
      }
      throw error;
    }
  }

  private resolveInput(input: StepInput | undefined, stepId: string): string | number | boolean {
    if (!input) {
      throw new HardFailure(`Step "${stepId}" is missing input`, { stepId });
    }
    if (input.source === "literal") {
      if (input.literal === undefined) {
        throw new HardFailure(`Step "${stepId}" literal input is empty`, { stepId });
      }
      return input.literal;
    }
    if (input.source === "parameter") {
      const name = input.parameter;
      if (!name) {
        throw new HardFailure(`Step "${stepId}" parameter input is missing name`, { stepId });
      }
      const def = this.capability.parameters.find((p) => p.name === name);
      const value = this.parameters[name] ?? def?.default;
      if (value === undefined) {
        throw new ValidationFailure(`Parameter "${name}" has no value`, [`step ${stepId}`]);
      }
      return value;
    }
    if (input.source === "output") {
      const name = input.output;
      if (!name) {
        throw new HardFailure(`Step "${stepId}" output input is missing name`, { stepId });
      }
      const value = this.outputs[name];
      if (value === undefined) {
        throw new HardFailure(`Output "${name}" has not been extracted yet`, { stepId });
      }
      return value;
    }
    const exhaustive: never = input.source;
    throw new HardFailure(`Unknown input source: ${String(exhaustive)}`, { stepId });
  }

  private interpolate(template: string): string {
    return template.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, name: string) => {
      if (name === "baseUrl") return this.capability.application.baseUrl;
      const def = this.capability.parameters.find((p) => p.name === name);
      const value = this.parameters[name] ?? def?.default;
      if (value === undefined) {
        throw new ValidationFailure(`Cannot interpolate {${name}}: parameter is missing`);
      }
      return String(value);
    });
  }

  private assertOrigin(stepId: string): void {
    getGuardrails().assertNavigationAllowed(this.page.url(), stepId);
    const pattern = this.capability.application.originPattern;
    if (!pattern) return;
    const url = this.page.url();
    if (!new RegExp(pattern).test(url)) {
      throw new HardFailure(
        `Page URL "${url}" does not match application originPattern /${pattern}/`,
        { stepId },
      );
    }
  }

  private async wait(spec: WaitSpec, stepId: string): Promise<void> {
    const timeout = spec.timeoutMs ?? 10_000;
    switch (spec.kind) {
      case "timeout":
        await this.page.waitForTimeout(timeout);
        return;
      case "url":
        if (!spec.urlPattern) {
          throw new HardFailure("waitFor url is missing urlPattern", { stepId });
        }
        await this.page.waitForURL(new RegExp(spec.urlPattern), { timeout });
        return;
      case "selector": {
        if (!spec.target) {
          throw new HardFailure("waitFor selector is missing target", { stepId });
        }
        await resolveTarget(this.page, spec.target, stepId);
        return;
      }
      case "loadState":
        await this.page.waitForLoadState(spec.loadState ?? "domcontentloaded", { timeout });
        return;
      default: {
        const exhaustive: never = spec.kind;
        throw new HardFailure(`Unsupported wait kind: ${String(exhaustive)}`, { stepId });
      }
    }
  }

  private async runCheckpoints(checkpoints: Checkpoint[], label: string): Promise<void> {
    for (const checkpoint of checkpoints) {
      await this.runCheckpoint(checkpoint, label);
    }
  }

  private async runCheckpoint(checkpoint: Checkpoint, label = "checkpoint"): Promise<void> {
    for (const assertion of checkpoint.assertions) {
      await this.runAssertion(assertion, `${label}:${checkpoint.id}`);
    }
  }

  private async runAssertion(assertion: Assertion, stepId: string): Promise<void> {
    const mismatch = async (message: string, observedText?: string) => {
      if (assertion.onMismatch === "business") {
        const code = assertion.businessFailureCode ?? "BUSINESS_ASSERTION_FAILED";
        const signal = this.capability.businessFailures.find((s) => s.code === code);
        throw new BusinessFailure(code, message, {
          stepId,
          recoverable: signal?.recoverable ?? false,
          observedText,
        });
      }
      throw new HardFailure(message, { stepId, locatorDescription: assertion.target?.description });
    };

    switch (assertion.kind) {
      case "urlMatches": {
        const pattern = assertion.urlPattern ?? assertion.expected;
        if (!pattern) {
          throw new HardFailure(`Assertion ${assertion.id} is missing urlPattern`, { stepId });
        }
        if (!new RegExp(pattern).test(this.page.url())) {
          await mismatch(`URL "${this.page.url()}" does not match /${pattern}/`);
        }
        return;
      }
      case "visible":
      case "hidden":
      case "textContains":
      case "textEquals":
      case "valueEquals": {
        if (!assertion.target) {
          throw new HardFailure(`Assertion ${assertion.id} is missing target`, { stepId });
        }
        if (assertion.kind === "hidden") {
          const visible = await isTargetVisible(this.page, assertion.target);
          if (visible) await mismatch(`Expected "${assertion.target.description}" to be hidden`);
          return;
        }
        if (assertion.kind === "visible") {
          try {
            await resolveTarget(this.page, assertion.target, stepId);
          } catch (error) {
            if (error instanceof HardFailure) {
              await mismatch(error.message);
              return;
            }
            throw error;
          }
          return;
        }
        let resolved;
        try {
          resolved = await resolveTarget(this.page, assertion.target, stepId);
        } catch (error) {
          if (error instanceof HardFailure) {
            await mismatch(error.message);
            return;
          }
          throw error;
        }
        if (assertion.kind === "textContains" || assertion.kind === "textEquals") {
          const text = (await resolved.locator.innerText()).trim();
          const expected = assertion.expected ?? "";
          const ok = assertion.kind === "textEquals" ? text === expected : text.includes(expected);
          if (!ok) await mismatch(`Text assertion failed. expected="${expected}" actual="${text}"`, text);
          return;
        }
        const value = await resolved.locator.inputValue();
        if (value !== (assertion.expected ?? "")) {
          await mismatch(
            `Value assertion failed. expected="${assertion.expected}" actual="${value}"`,
            value,
          );
        }
        return;
      }
      default: {
        const exhaustive: never = assertion.kind;
        throw new HardFailure(`Unsupported assertion kind: ${String(exhaustive)}`, { stepId });
      }
    }
  }

  private async detectBusinessFailure(stepId: string): Promise<BusinessFailure | undefined> {
    for (const signal of this.capability.businessFailures) {
      if (!(await isTargetVisible(this.page, signal.target))) continue;
      const resolved = await resolveTarget(this.page, signal.target, stepId);
      const text = (await resolved.locator.innerText()).trim();
      if (signal.messagePattern && !new RegExp(signal.messagePattern).test(text)) continue;
      return new BusinessFailure(signal.code, signal.description, {
        stepId,
        recoverable: signal.recoverable,
        observedText: text,
      });
    }
    return undefined;
  }

  private async extractDeclaredOutputs(): Promise<void> {
    for (const output of this.capability.expectedOutputs) {
      if (this.outputs[output.name] !== undefined) continue;
      const spec = output.extract;
      let raw: string;
      if (spec.method === "url") {
        raw = this.page.url();
      } else {
        if (!spec.target) {
          throw new HardFailure(`Output "${output.name}" extract is missing target`);
        }
        const resolved = await resolveTarget(this.page, spec.target);
        if (spec.method === "innerText") raw = (await resolved.locator.innerText()).trim();
        else if (spec.method === "inputValue") raw = await resolved.locator.inputValue();
        else {
          if (!spec.attribute) {
            throw new HardFailure(`Output "${output.name}" extract is missing attribute`);
          }
          raw = (await resolved.locator.getAttribute(spec.attribute)) ?? "";
        }
      }
      this.outputs[output.name] = applyPattern(raw, spec.pattern);
    }
  }
}

function applyPattern(raw: string, pattern?: string): string {
  if (!pattern) return raw;
  const match = raw.match(new RegExp(pattern));
  if (!match) {
    throw new HardFailure(`Extracted text "${raw}" did not match pattern /${pattern}/`);
  }
  return match[1] ?? match[0];
}

export function locatorDebug(target: Target): string {
  return [target.primary, ...target.fallbacks].map(describeLocator).join(" | ");
}

function toGotoUrl(url: string): string {
  if (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("file:")) {
    return url;
  }
  return pathToFileURL(resolve(url)).href;
}
