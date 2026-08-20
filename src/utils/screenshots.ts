import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "playwright";

const evidenceDir = join(dirname(fileURLToPath(import.meta.url)), "../../evidence");

function safeLabel(label: string): string {
  return label.replace(/[^A-Za-z0-9_-]+/g, "-").slice(0, 80) || "unknown";
}

export async function captureEvidence(page: Page, label: string): Promise<string> {
  mkdirSync(evidenceDir, { recursive: true });
  const filePath = join(evidenceDir, `${Date.now()}-${safeLabel(label)}.png`);
  await page.screenshot({ path: filePath, fullPage: true });
  return filePath;
}

export function interventionEvidenceDirectory(): string {
  const dir = join(evidenceDir, "interventions");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export async function captureInterventionScreenshot(page: Page, stepId: string): Promise<string> {
  const dir = interventionEvidenceDirectory();
  const filePath = join(dir, `${Date.now()}-${safeLabel(stepId)}-${Math.random().toString(36).slice(2, 8)}.png`);
  try {
    if (!page.isClosed()) {
      await page.screenshot({ path: filePath, fullPage: true });
    }
  } catch {
    // Page may be mid-navigation or crashed; the path is still recorded as evidence.
  }
  return filePath;
}

export function evidenceDirectory(): string {
  mkdirSync(evidenceDir, { recursive: true });
  return evidenceDir;
}
