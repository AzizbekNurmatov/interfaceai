export type {
  ActionType,
  ApplicationContext,
  Assertion,
  AssertionKind,
  BusinessFailureSignal,
  Capability,
  CapabilityMetadata,
  Checkpoint,
  ExpectedOutput,
  ExtractMethod,
  ExtractSpec,
  FailureClass,
  Locator,
  LocatorStrategy,
  OutputType,
  OutputValues,
  ParameterDef,
  ParameterType,
  ParameterValues,
  Step,
  StepInput,
  StepInputSource,
  Target,
  WaitKind,
  WaitSpec,
} from "./types/capability.js";
export { CAPABILITY_SCHEMA_VERSION } from "./types/capability.js";
export {
  BusinessFailure,
  HardFailure,
  ReplayError,
  ValidationFailure,
  isBusinessFailure,
  isHardFailure,
  isValidationFailure,
} from "./types/errors.js";
export { loadCapabilityFile, validateCapability } from "./schema/validate.js";
export { ReplayEngine } from "./replay/engine.js";
export { saveCapability } from "./discovery/index.js";
