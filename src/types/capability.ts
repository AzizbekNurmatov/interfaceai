/**
 * Capability artifact — the contract between Discovery and Replay.
 *
 * Discovery Script (probabilistic, LLM-driven) WRITES this document.
 * Replay Engine (deterministic, Playwright-driven) READS this document.
 * The Replay Engine must never call an LLM.
 */

export const CAPABILITY_SCHEMA_VERSION = "1.0.0" as const;

export type LocatorStrategy =
  | "role"
  | "label"
  | "placeholder"
  | "text"
  | "altText"
  | "title"
  | "testId"
  | "css"
  | "xpath";

export interface Locator {
  strategy: LocatorStrategy;
  value: string;
  /** Accessible name when strategy is `role`. */
  roleName?: string;
  exact?: boolean;
  nth?: number;
}

export interface Target {
  description: string;
  primary: Locator;
  fallbacks: Locator[];
  timeoutMs?: number;
}

export type ParameterType = "string" | "number" | "boolean" | "secret" | "enum";

export interface ParameterDef {
  name: string;
  type: ParameterType;
  required: boolean;
  description: string;
  enumValues?: string[];
  default?: string | number | boolean;
  maskInLogs?: boolean;
}

export type OutputType = "string" | "number" | "boolean";

export type ExtractMethod = "innerText" | "inputValue" | "attribute" | "url";

export interface ExtractSpec {
  target?: Target;
  method: ExtractMethod;
  attribute?: string;
  pattern?: string;
}

export interface ExpectedOutput {
  name: string;
  type: OutputType;
  description: string;
  extract: ExtractSpec;
}

export type StepInputSource = "parameter" | "literal" | "output";

export interface StepInput {
  source: StepInputSource;
  parameter?: string;
  literal?: string | number | boolean;
  output?: string;
}

export type WaitKind = "timeout" | "url" | "selector" | "loadState";

export interface WaitSpec {
  kind: WaitKind;
  timeoutMs?: number;
  urlPattern?: string;
  target?: Target;
  loadState?: "load" | "domcontentloaded" | "networkidle";
}

export type AssertionKind =
  | "visible"
  | "hidden"
  | "textContains"
  | "textEquals"
  | "urlMatches"
  | "valueEquals";

export type FailureClass = "hard" | "business";

export interface Assertion {
  id: string;
  kind: AssertionKind;
  target?: Target;
  expected?: string;
  urlPattern?: string;
  /**
   * hard → UI/locator drift; Replay Engine pauses for HITL.
   * business → known application outcome; Replay Engine returns BusinessFailure.
   */
  onMismatch: FailureClass;
  businessFailureCode?: string;
}

export interface Checkpoint {
  id: string;
  description: string;
  assertions: Assertion[];
}

export interface BusinessFailureSignal {
  code: string;
  description: string;
  target: Target;
  messagePattern?: string;
  recoverable: boolean;
}

export type ActionType =
  | "navigate"
  | "click"
  | "dblclick"
  | "fill"
  | "type"
  | "select"
  | "check"
  | "uncheck"
  | "press"
  | "hover"
  | "waitFor"
  | "extract"
  | "assertVisible"
  | "assertHidden"
  | "assertText"
  | "screenshot";

export interface Step {
  id: string;
  name: string;
  action: ActionType;
  url?: string;
  target?: Target;
  input?: StepInput;
  key?: string;
  waitAfter?: WaitSpec;
  checkpoint?: Checkpoint;
  extractTo?: string;
  optional?: boolean;
}

export interface ApplicationContext {
  name: string;
  baseUrl: string;
  originPattern?: string;
}

export interface CapabilityMetadata {
  discoveredAt?: string;
  lastVerifiedAt?: string;
  notes?: string;
}

export interface Capability {
  schemaVersion: typeof CAPABILITY_SCHEMA_VERSION;
  id: string;
  name: string;
  version: string;
  description: string;
  application: ApplicationContext;
  parameters: ParameterDef[];
  expectedOutputs: ExpectedOutput[];
  businessFailures: BusinessFailureSignal[];
  preconditions: Checkpoint[];
  steps: Step[];
  postconditions: Checkpoint[];
  metadata: CapabilityMetadata;
}

export type ParameterValues = Record<string, string | number | boolean>;

export type OutputValues = Record<string, string | number | boolean>;
