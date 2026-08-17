import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "playwright";

const evidenceDir = join(dirname(fileURLToPath(import.meta.url)), "../../evidence");

export async function captureEvidence(page: Page, label: string): Promise<string> {
  mkdirSync(evidenceDir, { recursive: true });
  const safe = label.replace(/[^A-Za-z0-9_-]+/g, "-").slice(0, 80);
  const filePath = join(evidenceDir, `${Date.now()}-${safe}.png`);
  await page.screenshot({ path: filePath, fullPage: true });
  return filePath;
}

export function evidenceDirectory(): string {
  mkdirSync(evidenceDir, { recursive: true });
  return evidenceDir;
}
