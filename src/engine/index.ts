export { ReplayEngine } from "./replay-engine.js";
export type { ReplayOptions, ReplayResult } from "./replay-engine.js";
export { runReplayCli, parseArgs } from "./cli.js";
export {
  requestHumanIntervention,
  classifyInterventionReason,
  canPromptOperator,
  handoffToHuman,
} from "./hitl.js";
export type {
  InterventionRequest,
  InterventionReason,
  InterventionContext,
  OperatorDecision,
  OperatorPrompt,
  HitlHandoffResult,
  HitlDecision,
} from "./hitl.js";
export { ReplayEvidence, REPLAY_LOG_PATH } from "./evidence.js";
export type { InterventionRecord, ReplayTraceEvent } from "./evidence.js";
