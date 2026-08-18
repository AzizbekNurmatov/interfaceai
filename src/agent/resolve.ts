import type { Locator as PwLocator, Page } from "playwright";
import type { Locator } from "../schema/capability.js";
import type { ObservedElement, PageSnapshot } from "./trace.js";

export interface ResolvedBinding {
  description: string;
  locators: Locator[];
  handle: PwLocator;
  element?: ObservedElement;
}

function uniqueLocators(locators: Locator[]): Locator[] {
  const seen = new Set<string>();
  const out: Locator[] = [];
  for (const loc of locators) {
    const key = `${loc.strategy}:${loc.value}:${loc.nth ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(loc);
  }
  return out;
}

export function locatorsFromElement(el: ObservedElement): Locator[] {
  const locators: Locator[] = [];
  if (el.css) locators.push({ strategy: "css", value: el.css });
  if (el.xpath) locators.push({ strategy: "xpath", value: el.xpath });
  if (el.name) locators.push({ strategy: "css", value: `${el.tag}[name='${el.name}']` });
  if (el.id) locators.push({ strategy: "css", value: `#${el.id}` });
  if (el.text && el.text.length > 0 && el.text.length <= 80 && el.kind === "interactive") {
    locators.push({ strategy: "text", value: el.text, exact: true });
  }
  return uniqueLocators(locators);
}

function looksLikeXpath(selector: string): boolean {
  return (
    selector.startsWith("//") ||
    selector.startsWith(".//") ||
    selector.startsWith("xpath=") ||
    selector.startsWith("(//")
  );
}

function playwrightFor(page: Page, locator: Locator): PwLocator {
  if (locator.strategy === "xpath") return page.locator(`xpath=${locator.value}`);
  if (locator.strategy === "text") {
    return page.getByText(locator.value, locator.exact ? { exact: true } : undefined);
  }
  return page.locator(locator.value);
}

async function isUsable(locator: PwLocator): Promise<boolean> {
  try {
    const count = await locator.count();
    if (count < 1) return false;
    return await locator.first().isVisible();
  } catch {
    return false;
  }
}

function scoreElement(el: ObservedElement, description: string): number {
  const q = description.trim().toLowerCase();
  if (!q) return 0;
  const hay = [el.ref, el.name, el.id, el.text, el.value, el.label, el.href, el.css]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (hay === q || el.ref.toLowerCase() === q) return 100;
  if (el.name?.toLowerCase() === q) return 90;
  if (el.text.toLowerCase() === q) return 85;
  if (el.label?.toLowerCase() === q) return 80;
  if (hay.includes(q)) return 60;
  const tokens = q.split(/\s+/).filter((t) => t.length > 2);
  const hits = tokens.filter((t) => hay.includes(t)).length;
  return hits === 0 ? 0 : (hits / tokens.length) * 40;
}

/**
 * Resolve a model-supplied selector or natural-language description.
 * Hallucinated selectors return undefined so the loop can ask the model to retry.
 */
export async function resolveBinding(
  page: Page,
  snapshot: PageSnapshot,
  args: { selector?: string; element_description?: string },
): Promise<ResolvedBinding | undefined> {
  const selector = args.selector?.trim();
  const description = args.element_description?.trim();

  if (selector) {
    const byRef = snapshot.elements.find((el) => el.ref === selector || `[${el.ref}]` === selector);
    if (byRef) {
      const locators = locatorsFromElement(byRef);
      const primary = locators[0];
      if (primary) {
        const handle = playwrightFor(page, primary).first();
        if (await isUsable(handle)) {
          return {
            description: description || byRef.text || byRef.name || byRef.ref,
            locators,
            handle,
            element: byRef,
          };
        }
      }
    }

    const locator: Locator = looksLikeXpath(selector)
      ? { strategy: "xpath", value: selector.replace(/^xpath=/, "") }
      : { strategy: "css", value: selector };
    const handle = playwrightFor(page, locator).first();
    if (await isUsable(handle)) {
      const el = snapshot.elements.find(
        (item) => item.css === selector || item.xpath === selector.replace(/^xpath=/, ""),
      );
      return {
        description: description || el?.text || el?.name || selector,
        locators: uniqueLocators([locator, ...(el ? locatorsFromElement(el) : [])]),
        handle,
        element: el,
      };
    }
  }

  if (description) {
    const ranked = snapshot.elements
      .map((el) => ({ el, score: scoreElement(el, description) }))
      .filter((row) => row.score >= 40)
      .sort((a, b) => b.score - a.score);
    for (const row of ranked) {
      const locators = locatorsFromElement(row.el);
      const primary = locators[0];
      if (!primary) continue;
      const handle = playwrightFor(page, primary).first();
      if (await isUsable(handle)) {
        return {
          description,
          locators,
          handle,
          element: row.el,
        };
      }
    }

    const textHandle = page.getByText(description, { exact: false }).first();
    if (await isUsable(textHandle)) {
      return {
        description,
        locators: [{ strategy: "text", value: description }],
        handle: textHandle,
      };
    }
  }

  return undefined;
}

export function describeUnresolved(snapshot: PageSnapshot): string {
  const refs = snapshot.elements
    .slice(0, 12)
    .map((el) => el.ref)
    .join(", ");
  return `No visible element matched. Available refs: ${refs || "(none)"}`;
}
