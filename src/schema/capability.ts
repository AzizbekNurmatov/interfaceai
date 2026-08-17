/**
 * Capability artifact — the contract between Discovery and Replay.
 *
 * Discovery / agent (probabilistic, LLM-driven) WRITES this document.
 * Replay Engine (deterministic, Playwright-driven) READS this document.
 * The Replay Engine must never call an LLM.
 */

import { z } from "zod";

export const CAPABILITY_SCHEMA_VERSION = "1.0.0" as const;

export const locatorStrategySchema = z.enum([
  "role",
  "label",
  "placeholder",
  "text",
  "altText",
  "title",
  "testId",
  "css",
  "xpath",
]);

export const locatorSchema = z
  .object({
    strategy: locatorStrategySchema,
    value: z.string().min(1),
    roleName: z.string().optional(),
    exact: z.boolean().optional(),
    nth: z.number().int().min(0).optional(),
  })
  .strict();

export const targetSchema = z
  .object({
    description: z.string().min(1),
    primary: locatorSchema,
    fallbacks: z.array(locatorSchema),
    timeoutMs: z.number().int().min(0).optional(),
  })
  .strict();

export const parameterDefSchema = z
  .object({
    name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
    type: z.enum(["string", "number", "boolean", "secret", "enum"]),
    required: z.boolean(),
    description: z.string(),
    enumValues: z.array(z.string()).min(1).optional(),
    default: z.union([z.string(), z.number(), z.boolean()]).optional(),
    maskInLogs: z.boolean().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.type === "enum" && !value.enumValues) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "enum parameters require enumValues",
        path: ["enumValues"],
      });
    }
  });

export const extractSpecSchema = z
  .object({
    target: targetSchema.optional(),
    method: z.enum(["innerText", "inputValue", "attribute", "url"]),
    attribute: z.string().optional(),
    pattern: z.string().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.method !== "url" && !value.target) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "extract target is required unless method is url",
        path: ["target"],
      });
    }
    if (value.method === "attribute" && !value.attribute) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "attribute is required when method is attribute",
        path: ["attribute"],
      });
    }
  });

export const expectedOutputSchema = z
  .object({
    name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
    type: z.enum(["string", "number", "boolean"]),
    description: z.string(),
    extract: extractSpecSchema,
  })
  .strict();

export const stepInputSchema = z
  .object({
    source: z.enum(["parameter", "literal", "output"]),
    parameter: z.string().optional(),
    literal: z.union([z.string(), z.number(), z.boolean()]).optional(),
    output: z.string().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.source === "parameter" && !value.parameter) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "parameter is required", path: ["parameter"] });
    }
    if (value.source === "literal" && value.literal === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "literal is required", path: ["literal"] });
    }
    if (value.source === "output" && !value.output) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "output is required", path: ["output"] });
    }
  });

export const waitSpecSchema = z
  .object({
    kind: z.enum(["timeout", "url", "selector", "loadState"]),
    timeoutMs: z.number().int().min(0).optional(),
    urlPattern: z.string().optional(),
    target: targetSchema.optional(),
    loadState: z.enum(["load", "domcontentloaded", "networkidle"]).optional(),
  })
  .strict();

export const assertionSchema = z
  .object({
    id: z.string().min(1),
    kind: z.enum(["visible", "hidden", "textContains", "textEquals", "urlMatches", "valueEquals"]),
    target: targetSchema.optional(),
    expected: z.string().optional(),
    urlPattern: z.string().optional(),
    onMismatch: z.enum(["hard", "business"]),
    businessFailureCode: z.string().optional(),
  })
  .strict();

export const checkpointSchema = z
  .object({
    id: z.string().min(1),
    description: z.string(),
    assertions: z.array(assertionSchema).min(1),
  })
  .strict();

export const businessFailureSignalSchema = z
  .object({
    code: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
    description: z.string(),
    target: targetSchema,
    messagePattern: z.string().optional(),
    recoverable: z.boolean(),
  })
  .strict();

export const actionTypeSchema = z.enum([
  "navigate",
  "click",
  "dblclick",
  "fill",
  "type",
  "select",
  "check",
  "uncheck",
  "press",
  "hover",
  "waitFor",
  "extract",
  "assertVisible",
  "assertHidden",
  "assertText",
  "screenshot",
]);

export const stepSchema = z
  .object({
    id: z.string().regex(/^[A-Za-z0-9_-]+$/),
    name: z.string().min(1),
    action: actionTypeSchema,
    url: z.string().optional(),
    target: targetSchema.optional(),
    input: stepInputSchema.optional(),
    key: z.string().optional(),
    waitAfter: waitSpecSchema.optional(),
    checkpoint: checkpointSchema.optional(),
    extractTo: z.string().optional(),
    optional: z.boolean().optional(),
  })
  .strict();

export const applicationContextSchema = z
  .object({
    name: z.string().min(1),
    baseUrl: z.string().min(1),
    originPattern: z.string().optional(),
  })
  .strict();

export const capabilityMetadataSchema = z
  .object({
    discoveredAt: z.string().datetime().optional(),
    lastVerifiedAt: z.string().datetime().optional(),
    notes: z.string().optional(),
  })
  .strict();

export const capabilitySchema = z
  .object({
    schemaVersion: z.literal(CAPABILITY_SCHEMA_VERSION),
    id: z.string().regex(/^[a-z][a-z0-9-]*$/),
    name: z.string().min(1),
    version: z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+$/),
    description: z.string().min(1),
    application: applicationContextSchema,
    parameters: z.array(parameterDefSchema),
    expectedOutputs: z.array(expectedOutputSchema),
    businessFailures: z.array(businessFailureSignalSchema),
    preconditions: z.array(checkpointSchema),
    steps: z.array(stepSchema).min(1),
    postconditions: z.array(checkpointSchema),
    metadata: capabilityMetadataSchema,
  })
  .strict();

export type LocatorStrategy = z.infer<typeof locatorStrategySchema>;
export type Locator = z.infer<typeof locatorSchema>;
export type Target = z.infer<typeof targetSchema>;
export type ParameterDef = z.infer<typeof parameterDefSchema>;
export type ParameterType = ParameterDef["type"];
export type ExtractSpec = z.infer<typeof extractSpecSchema>;
export type ExtractMethod = ExtractSpec["method"];
export type ExpectedOutput = z.infer<typeof expectedOutputSchema>;
export type OutputType = ExpectedOutput["type"];
export type StepInput = z.infer<typeof stepInputSchema>;
export type StepInputSource = StepInput["source"];
export type WaitSpec = z.infer<typeof waitSpecSchema>;
export type WaitKind = WaitSpec["kind"];
export type Assertion = z.infer<typeof assertionSchema>;
export type AssertionKind = Assertion["kind"];
export type FailureClass = Assertion["onMismatch"];
export type Checkpoint = z.infer<typeof checkpointSchema>;
export type BusinessFailureSignal = z.infer<typeof businessFailureSignalSchema>;
export type ActionType = z.infer<typeof actionTypeSchema>;
export type Step = z.infer<typeof stepSchema>;
export type ApplicationContext = z.infer<typeof applicationContextSchema>;
export type CapabilityMetadata = z.infer<typeof capabilityMetadataSchema>;
export type Capability = z.infer<typeof capabilitySchema>;

export type ParameterValues = Record<string, string | number | boolean>;
export type OutputValues = Record<string, string | number | boolean>;
