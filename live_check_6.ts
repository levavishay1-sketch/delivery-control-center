import { chromium } from "playwright";

const ADMIN_EMAIL = "admin@example.com";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || "change-me-now";

async function main() {
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  const page = await browser.newPage();

  await page.goto("http://localhost:3000/login");
  await page.fill('input[name="email"]', ADMIN_EMAIL);
  await page.fill('input[name="password"]', ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("http://localhost:3000/");

  const projectId = process.argv[2];
  const result = await page.evaluate(async (id) => {
    const res = await fetch(`/api/projects/${id}/ai-budget`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ budgetUsd: 0.0001 }),
    });
    return { status: res.status, body: await res.json() };
  }, projectId);
  console.log("ai-budget POST result:", result);

  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
