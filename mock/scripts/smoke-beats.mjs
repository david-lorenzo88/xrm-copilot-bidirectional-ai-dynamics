/**
 * Rehearsal smoke test: drives the three demo beats in a real browser against
 * `npm run demo` and saves screenshots. Optional tooling, not part of CI.
 *
 *   npm run demo                      # terminal 1
 *   npx playwright install chromium   # once (or set CHROME_PATH to a local Chrome)
 *   npm run smoke -w mock             # terminal 2 → out/smoke/*.png
 */
import { mkdirSync } from "node:fs";

const { chromium } = await import("playwright").catch(() => {
  console.error("playwright is not installed: npm i -D playwright && npx playwright install chromium");
  process.exit(1);
});

const url = process.env.DEMO_URL ?? "http://localhost:5173/";
const out = process.env.OUT_DIR ?? "out/smoke";
mkdirSync(out, { recursive: true });

const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
const control = 'section[aria-label="CollectionsBridge control"]';
const step = async (name, fn) => {
  await fn();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log(`✓ ${name}`);
};

await page.goto(url);
await step("beat1-grounded-start", async () => {
  await page.waitForSelector("text=Copilot has context");
  await page.waitForSelector("text=I can see you're on");
});
await step("beat2-agent-operates-app", async () => {
  await page.click("text=Analyze payment behavior");
  await page.waitForSelector('[aria-label="Side panes"]');
  await page.waitForSelector("text=prioritized by Copilot");
});
await step("beat3-dashboard-two-surfaces", async () => {
  await page.click("text=Build me a dashboard of overdue by customer and aging bucket");
  await page.waitForSelector(`${control} >> text=Overdue by customer and aging bucket`);
});
await step("beat3-in-app-change-reaches-agent", async () => {
  await page.locator(`${control} button:has-text("Current")`).click();
  await page.waitForSelector(`${control} >> text=/v2 \\(app\\)/`);
  await page.click("text=What does the dashboard show now?");
  await page.waitForSelector("text=You changed it in the app");
});
await step("bonus-follow-up-confirmed", async () => {
  await page.click("text=Log a follow-up: promised to pay SI-104008 by 2026-12-04");
  await page.waitForSelector("text=Nothing is logged until you send it");
  const card = page.frames().at(-1);
  await card.getByRole("button", { name: "Log in app" }).click();
  await page.click('button:has-text("Log follow-up")');
  await page.waitForSelector("text=Follow-up logged");
});

await browser.close();
if (errors.length) {
  console.error("Console errors:", errors);
  process.exit(1);
}
console.log(`All beats passed. Screenshots in ${out}/`);
