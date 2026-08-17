import "dotenv/config";
import { chromium, type Browser, type Page } from "playwright";
import { formatValidationIssues, loadCapabilityFile } from "../schema/validate.js";
import {
  isBusinessFailure,
  isHardFailure,
  isSafetyViolation,
  isValidationFailure,
  ValidationFailure,
} from "../schema/errors.js";
import type { ParameterValues } from "../schema/capability.js";
import { logger } from "../utils/logger.js";
import { ReplayEngine } from "./replay-engine.js";

export interface CliArgs {
  capabilityPath: string;
  parameters: ParameterValues;
  headed: boolean;
  hitl: boolean;
}

export function parseArgs(argv: string[]): CliArgs {
  const parameters: ParameterValues = {};
  let capabilityPath: string | undefined;
  let headed = true;
  let hitl = true;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--capability" || arg === "-c") {
      capabilityPath = argv[++i];
    } else if (arg === "--param" || arg === "-p") {
      const pair = argv[++i];
      if (!pair || !pair.includes("=")) {
        throw new ValidationFailure("Expected --param name=value");
      }
      const eq = pair.indexOf("=");
      const name = pair.slice(0, eq);
      const value = pair.slice(eq + 1);
      parameters[name] = coerce(value);
    } else if (arg === "--headed") {
      headed = true;
    } else if (arg === "--headless") {
      headed = false;
    } else if (arg === "--no-hitl") {
      hitl = false;
    } else if (arg === "--hitl") {
      hitl = true;
    } else if (arg?.startsWith("-")) {
      throw new ValidationFailure(`Unknown flag: ${arg}`);
    }
  }

  if (!capabilityPath) {
    throw new ValidationFailure("Missing --capability <path>");
  }

  return { capabilityPath, parameters, headed, hitl };
}

function coerce(value: string): string | number | boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  if (value !== "" && !Number.isNaN(Number(value)) && value.trim() === String(Number(value))) {
    return Number(value);
  }
  return value;
}

export async function runReplayCli(argv = process.argv.slice(2)): Promise<number> {
  let browser: Browser | undefined;
  let page: Page | undefined;
  try {
    const args = parseArgs(argv);
    const capability = loadCapabilityFile(args.capabilityPath);

    browser = await chromium.launch({ headless: !args.headed, slowMo: args.headed ? 50 : 0 });
    const context = await browser.newContext();
    page = await context.newPage();

    const engine = new ReplayEngine({
      page,
      capability,
      parameters: args.parameters,
      hitl: args.hitl,
    });

    const result = await engine.run();
    if (result.status === "success") {
      logger.info("replay succeeded", { outputs: result.outputs });
      console.log(JSON.stringify({ status: "success", outputs: result.outputs }, null, 2));
      return 0;
    }

    logger.warn("replay business failure", {
      code: result.failure.code,
      message: result.failure.message,
      observedText: result.failure.observedText,
    });
    console.log(
      JSON.stringify(
        {
          status: "business_failure",
          code: result.failure.code,
          recoverable: result.failure.recoverable,
          message: result.failure.message,
          observedText: result.failure.observedText,
          stepId: result.failure.stepId,
          outputs: result.outputs,
        },
        null,
        2,
      ),
    );
    return 2;
  } catch (error) {
    if (isValidationFailure(error)) {
      console.error(formatValidationIssues(error));
      return 1;
    }
    if (isSafetyViolation(error)) {
      logger.error("safety violation", { rule: error.rule, message: error.message });
      console.error(
        JSON.stringify(
          { status: "safety_violation", rule: error.rule, message: error.message, stepId: error.stepId },
          null,
          2,
        ),
      );
      return 4;
    }
    if (isHardFailure(error)) {
      console.error(
        JSON.stringify(
          {
            status: "hard_failure",
            message: error.message,
            stepId: error.stepId,
            locatorDescription: error.locatorDescription,
            attemptedLocators: error.attemptedLocators,
          },
          null,
          2,
        ),
      );
      return 3;
    }
    if (isBusinessFailure(error)) {
      console.error(error.message);
      return 2;
    }
    throw error;
  } finally {
    await page?.context().close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
  }
}

const isDirect = /engine[/\\]cli\.ts$/.test(process.argv[1] ?? "");
if (isDirect) {
  runReplayCli().then((code) => process.exit(code));
}
