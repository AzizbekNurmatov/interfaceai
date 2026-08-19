import Anthropic from "@anthropic-ai/sdk";
import type { MessageParam, Tool } from "@anthropic-ai/sdk/resources/messages/messages.js";

export interface LlmToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface LlmTurn {
  text: string;
  toolCalls: LlmToolCall[];
  rawAssistant: MessageParam;
}

export interface LlmClient {
  complete(args: {
    system: string;
    messages: MessageParam[];
    tools: Tool[];
  }): Promise<LlmTurn>;
}

export class AnthropicLlmClient implements LlmClient {
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(options?: { apiKey?: string; model?: string }) {
    this.client = new Anthropic({ apiKey: options?.apiKey ?? process.env.ANTHROPIC_API_KEY });
    this.model = options?.model ?? process.env.DISCOVERY_MODEL ?? "claude-sonnet-4-6";
  }

  async complete(args: {
    system: string;
    messages: MessageParam[];
    tools: Tool[];
  }): Promise<LlmTurn> {
    const message = await this.client.messages.create({
      model: this.model,
      max_tokens: 2048,
      system: args.system,
      tools: args.tools,
      tool_choice: { type: "auto", disable_parallel_tool_use: true },
      messages: args.messages,
    });

    const toolCalls: LlmToolCall[] = [];
    const texts: string[] = [];
    for (const block of message.content) {
      if (block.type === "text") texts.push(block.text);
      if (block.type === "tool_use") {
        toolCalls.push({
          id: block.id,
          name: block.name,
          input: (block.input ?? {}) as Record<string, unknown>,
        });
      }
    }

    return {
      text: texts.join("\n").trim(),
      toolCalls,
      rawAssistant: { role: "assistant", content: message.content },
    };
  }
}

/**
 * Deterministic stand-in for tests. Each complete() call returns the next scripted tool list.
 */
export class ScriptedLlmClient implements LlmClient {
  private index = 0;

  constructor(private readonly script: Array<Array<Omit<LlmToolCall, "id">>>) {}

  async complete(): Promise<LlmTurn> {
    const step = this.script[this.index] ?? [];
    this.index += 1;
    const toolCalls: LlmToolCall[] = step.map((call, i) => ({
      ...call,
      id: `tool_${this.index}_${i}`,
    }));
    const content = toolCalls.map((call) => ({
      type: "tool_use" as const,
      id: call.id,
      name: call.name,
      input: call.input,
    }));
    return {
      text: "",
      toolCalls,
      rawAssistant: { role: "assistant", content },
    };
  }
}
