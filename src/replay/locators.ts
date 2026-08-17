import type { Locator, Page } from "playwright";
import type { Locator as CapabilityLocator, Target } from "../types/capability.js";
import { HardFailure } from "../types/errors.js";

const DEFAULT_TIMEOUT_MS = 5_000;

export function describeLocator(locator: CapabilityLocator): string {
  const bits = [`${locator.strategy}=${locator.value}`];
  if (locator.roleName) bits.push(`name=${locator.roleName}`);
  if (locator.exact) bits.push("exact");
  if (locator.nth !== undefined) bits.push(`nth=${locator.nth}`);
  return bits.join(" ");
}

export function toPlaywrightLocator(page: Page, spec: CapabilityLocator): Locator {
  let loc: Locator;
  switch (spec.strategy) {
    case "role":
      loc = page.getByRole(
        spec.value as Parameters<Page["getByRole"]>[0],
        spec.roleName !== undefined
          ? { name: spec.roleName, exact: spec.exact }
          : spec.exact
            ? { exact: true }
            : undefined,
      );
      break;
    case "label":
      loc = page.getByLabel(spec.value, spec.exact !== undefined ? { exact: spec.exact } : undefined);
      break;
    case "placeholder":
      loc = page.getByPlaceholder(
        spec.value,
        spec.exact !== undefined ? { exact: spec.exact } : undefined,
      );
      break;
    case "text":
      loc = page.getByText(spec.value, spec.exact !== undefined ? { exact: spec.exact } : undefined);
      break;
    case "altText":
      loc = page.getByAltText(
        spec.value,
        spec.exact !== undefined ? { exact: spec.exact } : undefined,
      );
      break;
    case "title":
      loc = page.getByTitle(spec.value, spec.exact !== undefined ? { exact: spec.exact } : undefined);
      break;
    case "testId":
      loc = page.getByTestId(spec.value);
      break;
    case "css":
      loc = page.locator(spec.value);
      break;
    case "xpath":
      loc = page.locator(`xpath=${spec.value}`);
      break;
    default: {
      const exhaustive: never = spec.strategy;
      throw new HardFailure(`Unsupported locator strategy: ${String(exhaustive)}`);
    }
  }
  return spec.nth !== undefined ? loc.nth(spec.nth) : loc;
}

export interface ResolvedTarget {
  locator: Locator;
  used: CapabilityLocator;
  attempted: string[];
}

/**
 * Resolve primary, then fallbacks. A candidate counts as resolved when it
 * is visible within the target timeout. Missing targets become HardFailure
 * unless the caller treats the step as optional.
 */
export async function resolveTarget(
  page: Page,
  target: Target,
  stepId?: string,
): Promise<ResolvedTarget> {
  const timeout = target.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const candidates = [target.primary, ...target.fallbacks];
  const attempted: string[] = [];

  for (const spec of candidates) {
    const described = describeLocator(spec);
    attempted.push(described);
    const locator = toPlaywrightLocator(page, spec);
    try {
      await locator.waitFor({ state: "visible", timeout });
      return { locator, used: spec, attempted };
    } catch {
      // Try the next fallback. Do not swallow into a generic error.
    }
  }

  throw new HardFailure(
    `Could not resolve target "${target.description}" using ${attempted.length} locator(s)`,
    {
      stepId,
      locatorDescription: target.description,
      attemptedLocators: attempted,
    },
  );
}

/** Non-waiting probe used to scan business-failure banners. */
export async function isTargetVisible(page: Page, target: Target): Promise<boolean> {
  const candidates = [target.primary, ...target.fallbacks];
  for (const spec of candidates) {
    const locator = toPlaywrightLocator(page, spec);
    if (await locator.first().isVisible().catch(() => false)) return true;
  }
  return false;
}
