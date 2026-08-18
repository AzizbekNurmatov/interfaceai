import { expect, test } from "@playwright/test";
import { synthesizeCapability } from "../src/agent/synthesizer.js";
import { CapabilitySchema } from "../src/schema/capability.js";
import type { DiscoveryTrace } from "../src/agent/trace.js";

test("synthesizer parameterizes inputs and emits locators, outputs, and checkpoints", () => {
  const trace: DiscoveryTrace = {
    goal: "Log in as TELLER01 and lookup member 12345 savings balance",
    startUrl: "http://127.0.0.1:3000/login",
    applicationName: "MemberCore 7.4",
    finish: {
      summary: "Member balance inquiry",
      successCondition: "Savings balance is visible",
    },
    events: [
      {
        index: 0,
        timestamp: new Date().toISOString(),
        reasoning: "open",
        tool: "navigate",
        input: { url: "http://127.0.0.1:3000/login" },
        ok: true,
        result: "Opened",
        urlAfter: "http://127.0.0.1:3000/login",
        titleAfter: "Logon",
        locators: [],
        heading: "Teller Workstation Logon",
      },
      {
        index: 1,
        timestamp: new Date().toISOString(),
        reasoning: "uid",
        tool: "type",
        input: { selector: "input[name='txtUID']", value: "TELLER01", isParameter: true, paramName: "username" },
        ok: true,
        result: "typed",
        urlAfter: "http://127.0.0.1:3000/login",
        titleAfter: "Logon",
        locators: [
          { strategy: "css", value: "input[name='txtUID']" },
          { strategy: "xpath", value: "//input[@name='txtUID']" },
        ],
        description: "User ID",
        typedValue: "TELLER01",
        isParameter: true,
        paramName: "username",
      },
      {
        index: 2,
        timestamp: new Date().toISOString(),
        reasoning: "pwd",
        tool: "type",
        input: { selector: "input[name='txtPWD']", value: "[REDACTED]" },
        ok: true,
        result: "typed",
        urlAfter: "http://127.0.0.1:3000/login",
        titleAfter: "Logon",
        locators: [{ strategy: "css", value: "input[name='txtPWD']" }],
        description: "Password",
        typedValue: "PASSWORD",
        inputType: "password",
        isParameter: true,
        paramName: "password",
      },
      {
        index: 3,
        timestamp: new Date().toISOString(),
        reasoning: "logon",
        tool: "click",
        input: { selector: "input[name='btnLogon']" },
        ok: true,
        result: "clicked",
        urlAfter: "http://127.0.0.1:3000/dashboard",
        titleAfter: "Main Menu",
        locators: [
          { strategy: "css", value: "input[name='btnLogon']" },
          { strategy: "text", value: "Logon", exact: true },
        ],
        description: "Logon",
        heading: "Main Menu",
      },
      {
        index: 4,
        timestamp: new Date().toISOString(),
        reasoning: "search",
        tool: "click",
        input: { element_description: "Member Search" },
        ok: true,
        result: "clicked",
        urlAfter: "http://127.0.0.1:3000/members/lookup",
        titleAfter: "Member Search",
        locators: [{ strategy: "css", value: "a[href='/members/lookup']" }],
        description: "Member Search",
        heading: "Member Search",
      },
      {
        index: 5,
        timestamp: new Date().toISOString(),
        reasoning: "member",
        tool: "type",
        input: { selector: "input[name='memID']", value: "12345", isParameter: true, paramName: "memberId" },
        ok: true,
        result: "typed",
        urlAfter: "http://127.0.0.1:3000/members/lookup",
        titleAfter: "Member Search",
        locators: [{ strategy: "css", value: "input[name='memID']" }],
        description: "Member ID",
        typedValue: "12345",
        isParameter: true,
        paramName: "memberId",
      },
      {
        index: 6,
        timestamp: new Date().toISOString(),
        reasoning: "submit",
        tool: "click",
        input: { selector: "input[name='btnSearch']" },
        ok: true,
        result: "clicked",
        urlAfter: "http://127.0.0.1:3000/members/lookup?memID=12345",
        titleAfter: "Member Record",
        locators: [{ strategy: "css", value: "input[name='btnSearch']" }],
        description: "Search Member File",
        heading: "Member Record",
      },
      {
        index: 7,
        timestamp: new Date().toISOString(),
        reasoning: "extract",
        tool: "extract",
        input: { selector: "d1", fieldName: "savingsBalance" },
        ok: true,
        result: "Extracted savingsBalance=$14,250.00",
        urlAfter: "http://127.0.0.1:3000/members/lookup?memID=12345",
        titleAfter: "Member Record",
        locators: [
          {
            strategy: "xpath",
            value: "//td[contains(., 'Savings Balance')]/following-sibling::td[1]",
          },
        ],
        description: "Savings Balance",
        fieldName: "savingsBalance",
        extractedText: "$14,250.00",
        heading: "Member Record",
      },
      {
        index: 8,
        timestamp: new Date().toISOString(),
        reasoning: "done",
        tool: "finish",
        input: { summary: "ok", successCondition: "balance visible" },
        ok: true,
        result: "ok",
        urlAfter: "http://127.0.0.1:3000/members/lookup?memID=12345",
        titleAfter: "Member Record",
        locators: [],
      },
    ],
  };

  const capability = synthesizeCapability(trace, { id: "discovered-member-inquiry" });
  expect(() => CapabilitySchema.parse(capability)).not.toThrow();
  expect(capability.parameters.map((p) => p.name)).toEqual(
    expect.arrayContaining(["username", "password", "memberId"]),
  );
  expect(capability.parameters.find((p) => p.name === "password")?.type).toBe("secret");
  expect(capability.expectedOutputs.some((o) => o.name === "savingsBalance")).toBe(true);
  expect(capability.steps.some((s) => s.action === "navigate")).toBe(true);
  expect(capability.steps.filter((s) => s.action === "fill").every((s) => s.input?.source === "parameter")).toBe(
    true,
  );
  const fillMember = capability.steps.find((s) => s.input?.parameter === "memberId");
  expect(fillMember?.target?.primary).toBeTruthy();
  expect(fillMember?.target?.fallbacks).toBeDefined();
  expect(capability.preconditions.length).toBeGreaterThan(0);
  expect(capability.postconditions.length).toBeGreaterThan(0);
  expect(capability.steps.find((s) => s.action === "click")?.checkpoint).toBeTruthy();
});
