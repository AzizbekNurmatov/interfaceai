import type Anthropic from "@anthropic-ai/sdk";

type Tool = Anthropic.Tool;

export const DISCOVERY_TOOLS: Tool[] = [
  {
    name: "navigate",
    description: "Navigate the browser to an absolute or same-origin URL.",
    input_schema: {
      type: "object",
      properties: {
        url: { type: "string", description: "http(s) URL to open" },
      },
      required: ["url"],
    },
  },
  {
    name: "click",
    description:
      "Click a visible control. Prefer a snapshot ref (e1) or a CSS/XPath selector. Fall back to element_description.",
    input_schema: {
      type: "object",
      properties: {
        selector: {
          type: "string",
          description: "Snapshot ref (e1), CSS selector, or XPath",
        },
        element_description: {
          type: "string",
          description: "Human description, e.g. 'Logon button' or 'Member Search link'",
        },
      },
    },
  },
  {
    name: "type",
    description:
      "Fill a text or password field. Parameterize values that should vary at replay time (credentials, member IDs).",
    input_schema: {
      type: "object",
      properties: {
        selector: { type: "string" },
        element_description: { type: "string" },
        value: { type: "string", description: "Text to type into the field" },
        isParameter: {
          type: "boolean",
          description: "true if this value should become a capability parameter",
        },
        paramName: {
          type: "string",
          description: "Parameter name when isParameter is true, e.g. memberId, username, password",
        },
      },
      required: ["value"],
    },
  },
  {
    name: "waitFor",
    description: "Wait until a selector or visible text appears (spinners, delayed CICS responses).",
    input_schema: {
      type: "object",
      properties: {
        selector: { type: "string" },
        text: { type: "string", description: "Visible text to wait for" },
      },
    },
  },
  {
    name: "extract",
    description: "Read visible text from a node and store it as a named output of the capability.",
    input_schema: {
      type: "object",
      properties: {
        selector: { type: "string" },
        element_description: { type: "string" },
        fieldName: {
          type: "string",
          description: "Output name, camelCase, e.g. savingsBalance",
        },
      },
      required: ["fieldName"],
    },
  },
  {
    name: "finish",
    description: "Call when the goal is complete and required fields have been extracted.",
    input_schema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "What the flow accomplished" },
        successCondition: {
          type: "string",
          description: "How a later replay should know it succeeded",
        },
      },
      required: ["summary", "successCondition"],
    },
  },
];
