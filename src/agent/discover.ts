import type { Page } from "playwright";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages/messages.js";
import { getGuardrails } from "../safety/guardrails.js";
import { HardFailure, SafetyViolation, ValidationFailure } from "../schema/errors.js";
import type { Capability } from "../schema/capability.js";
import {
  classifyInterventionReason,
  requestHumanIntervention,
  type OperatorPrompt,
} from "../engine/hitl.js";
import { formatSnapshotForLlm, observePage, snapshotHeading } from "./observer.js";
import { describeUnresolved, resolveBinding } from "./resolve.js";
import { DISCOVERY_TOOLS } from "./tools.js";
import { AnthropicLlmClient, type LlmClient, type LlmToolCall } from "./llm.js";
import { DiscoveryEvidence } from "./evidence.js";
import { saveCapability, synthesizeCapability } from "./synthesizer.js";
import type { DiscoveryTrace, PageSnapshot, TraceEvent } from "./trace.js";

export const MAX_DISCOVERY_STEPS = 15;
export const DEFAULT_DISCOVERY_TIMEOUT_MS = 120_000;
export const CONSECUTIVE_FAILURES_BEFORE_HITL = 3;

export interface DiscoverOptions {
  page: Page;
  goal: string;
  startUrl: string;
  artifactPath?: string;
  capabilityId?: string;
  llm?: LlmClient;
  evidence?: DiscoveryEvidence;
  maxSteps?: number;
  timeoutMs?: number;
  applicationName?: string;
  hitl?: boolean;
  headed?: boolean;
  hitlPrompt?: OperatorPrompt;
}

export interface DiscoverResult {
  trace: DiscoveryTrace;
  capability: Capability;
  artifactPath: string;
}

const SYSTEM_PROMPT = `You are a computer-use discovery agent for a legacy banking application.
You explore the live page using tools, then finish so a deterministic Replay Engine can repeat the flow with NO LLM.

Rules:
- Observe the snapshot. Prefer snapshot refs (e1, d1) or name/id CSS selectors. Do not invent ids.
- Parameterize typed values: username, password, memberId, and any business key. Set isParameter=true and paramName.
- Never perform forbidden actions (wire transfer, delete, drop, close account).
- If a selector fails, retry with element_description or another ref from the snapshot.
- When the user goal is met, extract requested fields, then call finish.
- Keep the path short. One action per turn.`;

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asBoolean(value: unknown): boolean {
  return value === true || value === "true";
}

export class DiscoveryLoop {
  private snapshot: PageSnapshot | undefined;
  private readonly trace: DiscoveryTrace;
  private readonly startedAt = Date.now();
  private consecutiveFailures = 0;

  constructor(private readonly options: DiscoverOptions) {
    this.trace = {
      goal: options.goal,
      startUrl: options.startUrl,
      applicationName: options.applicationName ?? "Legacy application",
      events: [],
    };
  }

  async run(): Promise<DiscoverResult> {
    const { page, startUrl, evidence } = this.options;
    const maxSteps = this.options.maxSteps ?? MAX_DISCOVERY_STEPS;
    const timeoutMs = this.options.timeoutMs ?? DEFAULT_DISCOVERY_TIMEOUT_MS;
    const llm = this.options.llm ?? new AnthropicLlmClient();
    const artifactPath = this.options.artifactPath ?? "capabilities/discovered-member-inquiry.json";

    getGuardrails().assertNavigationAllowed(startUrl);
    getGuardrails().assertTextAllowed(this.options.goal);
    await page.goto(startUrl, { waitUntil: "domcontentloaded" });
    this.snapshot = await observePage(page);
    this.record({
      tool: "navigate",
      input: { url: startUrl },
      ok: true,
      result: `Opened ${startUrl}`,
      locators: [],
      heading: snapshotHeading(this.snapshot),
      reasoning: "Initial navigation from --url",
    });
    evidence?.record("navigate", { url: startUrl, snapshot: this.snapshot });

    const messages: MessageParam[] = [
      {
        role: "user",
        content: `Goal: ${this.options.goal}\n\n${formatSnapshotForLlm(this.snapshot)}`,
      },
    ];
    evidence?.record("prompt", { system: SYSTEM_PROMPT, user: messages[0] });

    let finished = false;
    let emptyTurns = 0;
    while (!finished) {
      this.assertBudget(maxSteps, timeoutMs);
      const turn = await llm.complete({ system: SYSTEM_PROMPT, messages, tools: DISCOVERY_TOOLS });
      evidence?.record("llm_turn", { text: turn.text, toolCalls: turn.toolCalls });
      messages.push(turn.rawAssistant);

      if (turn.toolCalls.length === 0) {
        emptyTurns += 1;
        if (emptyTurns >= 3) {
          throw new ValidationFailure("Model stopped calling tools before finish()");
        }
        messages.push({
          role: "user",
          content:
            "You must call a tool. Continue toward the goal or call finish if it is already complete.\n\n" +
            formatSnapshotForLlm(this.snapshot),
        });
        continue;
      }
      emptyTurns = 0;

      const toolResults: Array<{
        type: "tool_result";
        tool_use_id: string;
        content: string;
        is_error?: boolean;
      }> = [];

      for (const call of turn.toolCalls) {
        this.assertBudget(maxSteps, timeoutMs);
        const executed = await this.executeTool(call, turn.text);
        evidence?.record("tool_result", { call, result: executed.result, ok: executed.ok });
        if (executed.ok) this.consecutiveFailures = 0;
        if (call.name === "finish" && executed.ok) finished = true;
        toolResults.push({
          type: "tool_result",
          tool_use_id: call.id,
          content: `${executed.result}\n\n${formatSnapshotForLlm(this.snapshot!)}`,
          is_error: !executed.ok,
        });
      }

      messages.push({ role: "user", content: toolResults });
    }

    if (!this.trace.finish) {
      throw new ValidationFailure("Discovery ended without finish()");
    }

    const capability = synthesizeCapability(this.trace, { id: this.options.capabilityId });
    saveCapability(artifactPath, capability);
    evidence?.record("artifact", { path: artifactPath, id: capability.id });
    return { trace: this.trace, capability, artifactPath };
  }

  private assertBudget(maxSteps: number, timeoutMs: number): void {
    const toolCount = this.trace.events.length - 1;
    if (toolCount >= maxSteps) {
      throw new ValidationFailure(`Discovery exceeded max ${maxSteps} steps`, [
        `Recorded ${this.trace.events.length} events`,
      ]);
    }
    if (Date.now() - this.startedAt > timeoutMs) {
      throw new ValidationFailure(`Discovery exceeded timeout of ${timeoutMs}ms`);
    }
  }

  private async executeTool(
    call: LlmToolCall,
    reasoning: string,
  ): Promise<{ ok: boolean; result: string }> {
    try {
      return await this.dispatchTool(call, reasoning);
    } catch (error) {
      if (error instanceof SafetyViolation || error instanceof ValidationFailure || error instanceof HardFailure) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      this.consecutiveFailures += 1;
      const failed = this.fail(call, reasoning, `Action failed: ${message}`);
      await this.maybeEscalateToHitl(call.name, message);
      return failed;
    }
  }

  private async dispatchTool(
    call: LlmToolCall,
    reasoning: string,
  ): Promise<{ ok: boolean; result: string }> {
    const page = this.options.page;
    const input = call.input;
    const guardrails = getGuardrails();
    guardrails.assertTextAllowed(`${call.name} ${JSON.stringify(input)}`);

    if (call.name === "navigate") {
      const url = asString(input.url);
      if (!url) return this.fail(call, reasoning, "navigate requires url");
      const absolute = new URL(url, page.url()).href;
      guardrails.assertNavigationAllowed(absolute);
      await page.goto(absolute, { waitUntil: "domcontentloaded" });
      await this.refreshSnapshot();
      this.record({
        tool: "navigate",
        input,
        ok: true,
        result: `Navigated to ${absolute}`,
        locators: [],
        reasoning,
        heading: snapshotHeading(this.snapshot!),
      });
      return { ok: true, result: `Navigated to ${absolute}` };
    }

    if (call.name === "click" || call.name === "type" || call.name === "extract") {
      const binding = await resolveBinding(page, this.snapshot!, {
        selector: asString(input.selector),
        element_description: asString(input.element_description),
      });
      if (!binding) {
        const message = describeUnresolved(this.snapshot!);
        this.consecutiveFailures += 1;
        this.record({
          tool: call.name,
          input,
          ok: false,
          result: message,
          locators: [],
          reasoning,
        });
        await this.maybeEscalateToHitl(call.name, message);
        return { ok: false, result: message };
      }

      guardrails.assertTextAllowed(
        [binding.description, binding.element?.text, binding.element?.value, binding.element?.name].join(" "),
      );

      if (call.name === "click") {
        if (binding.element?.href) {
          guardrails.assertNavigationAllowed(new URL(binding.element.href, page.url()).href);
        }
        await binding.handle.click({ timeout: 8_000 });
        await page.waitForLoadState("domcontentloaded").catch(() => undefined);
        await this.refreshSnapshot();
        this.record({
          tool: "click",
          input,
          ok: true,
          result: `Clicked ${binding.description}`,
          locators: binding.locators,
          description: binding.description,
          reasoning,
          heading: snapshotHeading(this.snapshot!),
        });
        return { ok: true, result: `Clicked ${binding.description}` };
      }

      if (call.name === "type") {
        const value = asString(input.value);
        if (value === undefined) return this.fail(call, reasoning, "type requires value");
        await binding.handle.fill(value);
        await this.refreshSnapshot();
        const paramName = asString(input.paramName);
        const isParameter = asBoolean(input.isParameter) || Boolean(paramName);
        this.record({
          tool: "type",
          input: { ...input, value: binding.element?.inputType === "password" ? "[REDACTED]" : value },
          ok: true,
          result: `Typed into ${binding.description}`,
          locators: binding.locators,
          description: binding.description,
          reasoning,
          typedValue: value,
          isParameter,
          paramName,
          inputType: binding.element?.inputType,
          heading: snapshotHeading(this.snapshot!),
        });
        return { ok: true, result: `Typed into ${binding.description}` };
      }

      const fieldName = asString(input.fieldName);
      if (!fieldName) return this.fail(call, reasoning, "extract requires fieldName");
      const extracted = (await binding.handle.innerText()).trim();
      this.record({
        tool: "extract",
        input,
        ok: true,
        result: `Extracted ${fieldName}=${extracted}`,
        locators: binding.locators,
        description: binding.description,
        reasoning,
        fieldName,
        extractedText: extracted,
        heading: snapshotHeading(this.snapshot!),
      });
      return { ok: true, result: `Extracted ${fieldName}=${getGuardrails().maskText(extracted)}` };
    }

    if (call.name === "waitFor") {
      const selector = asString(input.selector);
      const text = asString(input.text);
      if (!selector && !text) return this.fail(call, reasoning, "waitFor requires selector or text");
      if (text) {
        await page.getByText(text).first().waitFor({ state: "visible", timeout: 10_000 });
      } else if (selector) {
        const binding = await resolveBinding(page, this.snapshot!, { selector });
        if (!binding) {
          await page.locator(selector).first().waitFor({ state: "visible", timeout: 10_000 });
        } else {
          await binding.handle.waitFor({ state: "visible", timeout: 10_000 });
        }
      }
      await this.refreshSnapshot();
      this.record({
        tool: "waitFor",
        input,
        ok: true,
        result: `Waited for ${text ?? selector}`,
        locators: [],
        reasoning,
        heading: snapshotHeading(this.snapshot!),
      });
      return { ok: true, result: `Waited for ${text ?? selector}` };
    }

    if (call.name === "finish") {
      const summary = asString(input.summary) ?? "Goal complete";
      const successCondition = asString(input.successCondition) ?? "Outputs are visible";
      this.trace.finish = { summary, successCondition };
      this.record({
        tool: "finish",
        input,
        ok: true,
        result: summary,
        locators: [],
        reasoning,
        heading: snapshotHeading(this.snapshot!),
      });
      return { ok: true, result: `Finished: ${summary}` };
    }

    return this.fail(call, reasoning, `Unknown tool ${call.name}`);
  }

  private fail(
    call: LlmToolCall,
    reasoning: string,
    result: string,
  ): { ok: boolean; result: string } {
    this.record({
      tool: (["navigate", "click", "type", "waitFor", "extract", "finish"] as const).includes(
        call.name as "click",
      )
        ? (call.name as TraceEvent["tool"])
        : "click",
      input: call.input,
      ok: false,
      result,
      locators: [],
      reasoning,
    });
    return { ok: false, result };
  }

  private async maybeEscalateToHitl(stepId: string, message: string): Promise<void> {
    if (!this.options.hitl) return;

    const pageText = this.snapshot?.textPreview ?? "";
    const reason = classifyInterventionReason({ message, pageText });
    const stuck = this.consecutiveFailures >= CONSECUTIVE_FAILURES_BEFORE_HITL;
    const blocking = reason === "CAPTCHA_CHALLENGE" || reason === "UNEXPECTED_DIALOG";
    if (!stuck && !blocking) return;

    const capabilityId = this.options.capabilityId ?? "discovery";
    const handoff = await requestHumanIntervention(this.options.page, {
      capabilityId,
      stepId,
      message,
      reason: blocking ? reason : stuck ? "LOCATOR_FAILURE" : reason,
      headed: this.options.headed,
      prompt: this.options.hitlPrompt,
      evidence: this.options.evidence,
    });
    this.options.evidence?.record("hitl_decision", {
      stepId,
      decision: handoff.decision,
      reason: handoff.request.reason,
    });

    if (handoff.decision === "abort") {
      throw new HardFailure(`Discovery aborted by operator at ${stepId}: ${message}`, { stepId });
    }

    this.consecutiveFailures = 0;
    await this.refreshSnapshot();
  }

  private async refreshSnapshot(): Promise<void> {
    this.snapshot = await observePage(this.options.page);
  }

  private record(
    partial: Omit<TraceEvent, "index" | "timestamp" | "urlAfter" | "titleAfter">,
  ): void {
    this.trace.events.push({
      ...partial,
      index: this.trace.events.length,
      timestamp: new Date().toISOString(),
      urlAfter: this.snapshot?.url ?? this.options.page.url(),
      titleAfter: this.snapshot?.title ?? "",
    });
  }
}

export async function runDiscoveryLoop(options: DiscoverOptions): Promise<DiscoverResult> {
  return await new DiscoveryLoop(options).run();
}
