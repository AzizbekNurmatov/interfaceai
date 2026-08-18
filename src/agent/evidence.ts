import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getGuardrails } from "../safety/guardrails.js";

const evidenceDir = join(dirname(fileURLToPath(import.meta.url)), "../../evidence");

export const DISCOVERY_LOG_PATH = join(evidenceDir, "discovery-run.log");
export const DISCOVERY_SCREENSHOT_PATH = join(evidenceDir, "discovery-final.png");

export class DiscoveryEvidence {
  private readonly lines: string[] = [];

  constructor() {
    mkdirSync(evidenceDir, { recursive: true });
    writeFileSync(DISCOVERY_LOG_PATH, "", "utf8");
  }

  record(event: string, data?: unknown): void {
    const payload = getGuardrails().maskUnknown({
      ts: new Date().toISOString(),
      event,
      data,
    });
    const line = JSON.stringify(payload);
    this.lines.push(line);
    appendFileSync(DISCOVERY_LOG_PATH, `${line}\n`, "utf8");
  }

  get path(): string {
    return DISCOVERY_LOG_PATH;
  }
}
