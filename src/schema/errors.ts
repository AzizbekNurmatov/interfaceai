/**
 * Replay Engine error taxonomy.
 *
 * Do not wrap Playwright calls in generic try/catch that collapses these.
 * Callers must branch on `kind` (and `instanceof`) to decide HITL vs return.
 */

export type ReplayErrorKind = "business" | "hard" | "validation" | "safety";

export abstract class ReplayError extends Error {
  abstract readonly kind: ReplayErrorKind;
  readonly stepId?: string;
  readonly causeError?: unknown;

  constructor(message: string, options?: { stepId?: string; cause?: unknown }) {
    super(message, options?.cause ? { cause: options.cause } : undefined);
    this.name = this.constructor.name;
    this.stepId = options?.stepId;
    this.causeError = options?.cause;
  }
}

/**
 * The application produced a known, valid business outcome
 * (member not found, account locked). This is NOT an automation defect.
 * Do not invoke HITL.
 */
export class BusinessFailure extends ReplayError {
  readonly kind = "business" as const;
  readonly code: string;
  readonly recoverable: boolean;
  readonly observedText?: string;

  constructor(
    code: string,
    message: string,
    options?: {
      stepId?: string;
      recoverable?: boolean;
      observedText?: string;
      cause?: unknown;
    },
  ) {
    super(message, options);
    this.code = code;
    this.recoverable = options?.recoverable ?? false;
    this.observedText = options?.observedText;
  }
}

/**
 * The automation contract broke: locator missed, timeout, unexpected screen.
 * Invoke HITL (`page.pause()` + CLI).
 */
export class HardFailure extends ReplayError {
  readonly kind = "hard" as const;
  readonly locatorDescription?: string;
  readonly attemptedLocators?: string[];

  constructor(
    message: string,
    options?: {
      stepId?: string;
      locatorDescription?: string;
      attemptedLocators?: string[];
      cause?: unknown;
    },
  ) {
    super(message, options);
    this.locatorDescription = options?.locatorDescription;
    this.attemptedLocators = options?.attemptedLocators;
  }
}

/**
 * The capability JSON is invalid, or required replay parameters are missing.
 * Fail before touching the page when possible.
 */
export class ValidationFailure extends ReplayError {
  readonly kind = "validation" as const;
  readonly issues: string[];

  constructor(message: string, issues: string[] = []) {
    super(message);
    this.issues = issues;
  }
}

/**
 * A safety policy blocked the action (off-domain navigation, banned keyword).
 * Abort. Do not invoke HITL.
 */
export class SafetyViolation extends ReplayError {
  readonly kind = "safety" as const;
  readonly rule: string;

  constructor(rule: string, message: string, options?: { stepId?: string; cause?: unknown }) {
    super(message, options);
    this.rule = rule;
  }
}

export function isBusinessFailure(error: unknown): error is BusinessFailure {
  return error instanceof BusinessFailure;
}

export function isHardFailure(error: unknown): error is HardFailure {
  return error instanceof HardFailure;
}

export function isValidationFailure(error: unknown): error is ValidationFailure {
  return error instanceof ValidationFailure;
}

export function isSafetyViolation(error: unknown): error is SafetyViolation {
  return error instanceof SafetyViolation;
}
