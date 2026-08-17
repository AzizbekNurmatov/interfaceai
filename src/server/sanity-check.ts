import "dotenv/config";
import { chromium } from "playwright";
import { startMockServer } from "./listen.js";

async function main(): Promise<void> {
  const started = await startMockServer(0);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const loginUrl = `${started.baseUrl}/login`;
    const response = await page.goto(loginUrl, { waitUntil: "domcontentloaded" });
    const status = response?.status() ?? 0;
    const title = await page.title();
    const hasLogon = await page.locator('input[name="btnLogon"]').count();
    const hasUser = await page.locator('input[name="txtUID"]').count();

    if (status !== 200 || hasLogon < 1 || hasUser < 1) {
      throw new Error(
        `Mock portal not reachable. status=${status} title=${title} logon=${hasLogon} uid=${hasUser}`,
      );
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          url: loginUrl,
          status,
          title,
        },
        null,
        2,
      ),
    );
  } finally {
    await browser.close();
    await new Promise<void>((resolve, reject) => {
      started.server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
