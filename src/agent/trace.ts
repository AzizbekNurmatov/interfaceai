import type { Locator } from "../schema/capability.js";

export interface ObservedElement {
  ref: string;
  kind: "interactive" | "data";
  tag: string;
  name?: string;
  id?: string;
  inputType?: string;
  href?: string;
  text: string;
  value?: string;
  label?: string;
  css?: string;
  xpath?: string;
  box?: { x: number; y: number; width: number; height: number };
}

export interface PageSnapshot {
  url: string;
  title: string;
  textPreview: string;
  errorBanner?: string;
  elements: ObservedElement[];
}

export interface TraceEvent {
  index: number;
  timestamp: string;
  reasoning: string;
  tool: "navigate" | "click" | "type" | "waitFor" | "extract" | "finish";
  input: Record<string, unknown>;
  ok: boolean;
  result: string;
  urlAfter: string;
  titleAfter: string;
  locators: Locator[];
  description?: string;
  typedValue?: string;
  isParameter?: boolean;
  paramName?: string;
  inputType?: string;
  fieldName?: string;
  extractedText?: string;
  heading?: string;
}

export interface FinishPayload {
  summary: string;
  successCondition: string;
}

export interface DiscoveryTrace {
  goal: string;
  startUrl: string;
  applicationName: string;
  events: TraceEvent[];
  finish?: FinishPayload;
}
