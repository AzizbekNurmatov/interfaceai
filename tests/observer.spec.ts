import { expect, test } from "@playwright/test";
import { observePage, formatSnapshotForLlm } from "../src/agent/observer.js";
import { MOCK_CREDENTIALS } from "../src/server/members.js";

test("observer captures logon controls and masks password values", async ({ page }) => {
  await page.goto("/login");
  const snapshot = await observePage(page);
  const formatted = formatSnapshotForLlm(snapshot);

  expect(snapshot.title).toMatch(/MemberCore/);
  const names = snapshot.elements.map((el) => el.name);
  expect(names).toEqual(expect.arrayContaining(["txtUID", "txtPWD", "btnLogon"]));

  const password = snapshot.elements.find((el) => el.name === "txtPWD");
  expect(password?.inputType).toBe("password");
  expect(password?.value).toBe("[REDACTED]");
  expect(formatted).not.toContain(MOCK_CREDENTIALS.password);
  expect(formatted).toMatch(/\[e\d+\]/);
});

test("observer exposes labeled balance cells after inquiry", async ({ page }) => {
  await page.goto("/login");
  await page.locator("input[name='txtUID']").fill(MOCK_CREDENTIALS.username);
  await page.locator("input[name='txtPWD']").fill(MOCK_CREDENTIALS.password);
  await page.locator("input[name='btnLogon']").click();
  await page.locator("a[href='/members/lookup']").click();
  await page.locator("input[name='memID']").fill("12345");
  await page.locator("input[name='btnSearch']").click();
  await page.getByText("Savings Balance").waitFor();

  const snapshot = await observePage(page);
  const savings = snapshot.elements.find((el) => el.label === "Savings Balance");
  expect(savings?.value).toBe("$14,250.00");
  expect(savings?.ref).toMatch(/^d\d+$/);
  expect(savings?.xpath).toContain("Savings Balance");
  expect(snapshot.textPreview).not.toContain("123-45-6789");
});
