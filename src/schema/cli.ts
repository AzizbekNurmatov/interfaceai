import { loadCapabilityFile, formatValidationIssues } from "./validate.js";
import { isValidationFailure } from "../types/errors.js";

const path = process.argv[2];
if (!path) {
  console.error("Usage: npm run validate -- <path-to-capability.json>");
  process.exit(1);
}

try {
  const capability = loadCapabilityFile(path);
  console.log(`OK  ${capability.id}@${capability.version}  (${capability.steps.length} steps)`);
} catch (error) {
  if (isValidationFailure(error)) {
    console.error(formatValidationIssues(error));
    process.exit(1);
  }
  throw error;
}
