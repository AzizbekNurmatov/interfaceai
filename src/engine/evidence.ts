import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getGuardrails } from "../safety/guardrails.js";
import type { InterventionRequest, OperatorDecision } from "./hitl.js";

const evidenceDir = join(dirname(fileURLToPath(import.meta.url)), "../../evidence");

export const REPLAY_LOG_PATH = join(evidenceDir, "replay-run.log");

export interface InterventionRecord {
  request: InterventionRequest;
  decision: OperatorDecision;
}

export interface ReplayTraceEvent {
  ts: string;
  event: string;
  data?: unknown;
}

export class ReplayEvidence {
  readonly path: string;
  private readonly lines: string[] = [];
  readonly trace: ReplayTraceEvent[] = [];
  readonly interventions: InterventionRecord[] = [];

  constructor(options?: { path?: string; truncate?: boolean }) {
    this.path = options?.path ?? REPLAY_LOG_PATH;
    mkdirSync(dirname(this.path), { recursive: true });
    mkdirSync(join(evidenceDir, "interventions"), { recursive: true });
    if (options?.truncate ?? true) {
      writeFileSync(this.path, "", "utf8");
    }
  }

  record(event: string, data?: unknown): void {
    const ts = new Date().toISOString();
    const payload = getGuardrails().maskUnknown({ ts, event, data });
    const line = JSON.stringify(payload);
    this.lines.push(line);
    this.trace.push({ ts, event, data });
    appendFileSync(this.path, `${line}\n`, "utf8");
  }

  recordIntervention(request: InterventionRequest, decision: OperatorDecision): void {
    this.interventions.push({ request, decision });
    this.record("hitl_intervention", { request, decision });
  }
}
