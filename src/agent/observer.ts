import type { Page } from "playwright";
import { getGuardrails } from "../safety/guardrails.js";
import type { ObservedElement, PageSnapshot } from "./trace.js";

const MAX_INTERACTIVE = 30;
const MAX_DATA = 15;
const MAX_TEXT = 1_500;

function cssFor(info: { tag: string; name?: string; id?: string; href?: string; inputType?: string; value?: string }): string | undefined {
  if (info.id) return `#${info.id}`;
  if (info.name) return `${info.tag}[name='${info.name}']`;
  if (info.tag === "a" && info.href) return `a[href='${info.href}']`;
  if (info.tag === "input" && info.inputType === "submit" && info.value) {
    return `input[type='submit'][value='${info.value}']`;
  }
  return undefined;
}

function xpathFor(info: { tag: string; name?: string; id?: string; href?: string }): string | undefined {
  if (info.id) return `//*[@id="${info.id}"]`;
  if (info.name) return `//${info.tag}[@name="${info.name}"]`;
  if (info.tag === "a" && info.href) return `//a[@href="${info.href}"]`;
  return undefined;
}

function maskElement(el: ObservedElement): ObservedElement {
  const guardrails = getGuardrails();
  const sensitive =
    el.inputType === "password" || guardrails.maskUnknown("x", el.name) === "[REDACTED]";
  return {
    ...el,
    text: guardrails.maskText(el.text),
    value: sensitive ? "[REDACTED]" : el.value ? guardrails.maskText(el.value) : undefined,
    label: el.label ? guardrails.maskText(el.label) : undefined,
  };
}

/**
 * Compact, masked snapshot of the current page for the discovery LLM.
 * Interactive controls get e-refs; labeled table cells get d-refs.
 */
export async function observePage(page: Page): Promise<PageSnapshot> {
  const guardrails = getGuardrails();
  const url = page.url();
  const title = await page.title();
  const elements: ObservedElement[] = [];

  const interactive = page.locator("a, button, input, select, textarea");
  const interactiveCount = Math.min(await interactive.count(), MAX_INTERACTIVE);
  for (let i = 0; i < interactiveCount; i += 1) {
    const loc = interactive.nth(i);
    if (!(await loc.isVisible().catch(() => false))) continue;
    const info = await loc.evaluate((node) => {
      const el = node as HTMLElement;
      const input = node as HTMLInputElement;
      return {
        tag: el.tagName.toLowerCase(),
        name: el.getAttribute("name") ?? undefined,
        id: el.id || undefined,
        inputType: input.type || undefined,
        href: el.getAttribute("href") ?? undefined,
        text: (el.innerText || input.value || el.getAttribute("value") || "").trim().slice(0, 120),
        value: input.type === "password" ? undefined : input.value || undefined,
        box: (() => {
          const b = el.getBoundingClientRect();
          return {
            x: Math.round(b.x),
            y: Math.round(b.y),
            width: Math.round(b.width),
            height: Math.round(b.height),
          };
        })(),
      };
    });
    const ref = `e${elements.filter((e) => e.kind === "interactive").length + 1}`;
    elements.push(
      maskElement({
        ref,
        kind: "interactive",
        tag: info.tag,
        name: info.name,
        id: info.id,
        inputType: info.inputType,
        href: info.href,
        text: info.text,
        value: info.value,
        css: cssFor(info),
        xpath: xpathFor(info),
        box: info.box,
      }),
    );
  }

  const rows = page.locator("tr");
  const rowCount = await rows.count();
  let dataCount = 0;
  for (let i = 0; i < rowCount && dataCount < MAX_DATA; i += 1) {
    const row = rows.nth(i);
    const cells = row.locator("td");
    if ((await cells.count()) < 2) continue;
    const label = ((await cells.nth(0).innerText().catch(() => "")) || "").trim();
    const value = ((await cells.nth(1).innerText().catch(() => "")) || "").trim();
    if (!label || !value || label.length > 80 || value.length > 200) continue;
    if (label.toLowerCase() === value.toLowerCase()) continue;
    const safeLabel = label.replace(/"/g, "'");
    dataCount += 1;
    elements.push(
      maskElement({
        ref: `d${dataCount}`,
        kind: "data",
        tag: "td",
        label,
        text: value,
        value,
        xpath: `//td[contains(., "${safeLabel}")]/following-sibling::td[1]`,
      }),
    );
  }

  const bodyText = guardrails.maskText(
    (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").trim(),
  );
  const errorLoc = page.locator("#tblError");
  const errorBanner =
    (await errorLoc.count()) > 0
      ? guardrails.maskText(((await errorLoc.innerText({ timeout: 1_000 }).catch(() => "")) || "").trim()) ||
        undefined
      : undefined;

  return {
    url,
    title: guardrails.maskText(title),
    textPreview: bodyText.slice(0, MAX_TEXT),
    errorBanner: errorBanner || undefined,
    elements,
  };
}

export function formatSnapshotForLlm(snapshot: PageSnapshot): string {
  const lines: string[] = [
    `URL: ${snapshot.url}`,
    `Title: ${snapshot.title}`,
    snapshot.errorBanner ? `Error banner: ${snapshot.errorBanner}` : "",
    `Visible text: ${snapshot.textPreview}`,
    "",
    "Interactive elements (use ref, css, xpath, or a short description):",
  ];
  for (const el of snapshot.elements.filter((e) => e.kind === "interactive")) {
    const bits = [
      `[${el.ref}]`,
      el.tag,
      el.inputType ? `type=${el.inputType}` : "",
      el.name ? `name=${el.name}` : "",
      el.id ? `id=${el.id}` : "",
      el.href ? `href=${el.href}` : "",
      el.css ? `css=${el.css}` : "",
      el.xpath ? `xpath=${el.xpath}` : "",
      el.text ? `text="${el.text}"` : "",
      el.value ? `value="${el.value}"` : "",
    ].filter(Boolean);
    lines.push(bits.join(" "));
  }
  const data = snapshot.elements.filter((e) => e.kind === "data");
  if (data.length > 0) {
    lines.push("", "Data cells (extract these with ref or xpath):");
    for (const el of data) {
      lines.push(
        `[${el.ref}] label="${el.label ?? ""}" value="${el.value ?? el.text}" xpath=${el.xpath ?? ""}`,
      );
    }
  }
  return getGuardrails().maskText(lines.filter(Boolean).join("\n"));
}

export function snapshotHeading(snapshot: PageSnapshot): string | undefined {
  const match = snapshot.textPreview.match(
    /\b(Teller Workstation Logon|Main Menu|Member Search|Member Record|Account Servicing|INQUIRY RESULT)\b/,
  );
  return match?.[1] ?? snapshot.title.split(" - ").at(-1);
}
