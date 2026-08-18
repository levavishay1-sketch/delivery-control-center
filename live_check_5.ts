import { chromium } from "playwright";

const ADMIN_EMAIL = "admin@example.com";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || "change-me-now";

async function main() {
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  const page = await browser.newPage();
  const consoleErrors: string[] = [];
  page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
  page.on("pageerror", (err) => consoleErrors.push(err.message));

  await page.goto("http://localhost:3000/login");
  await page.fill('input[name="email"]', ADMIN_EMAIL);
  await page.fill('input[name="password"]', ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("http://localhost:3000/");

  const suffix = Date.now().toString(36);
  const projectName = `Budget UI Live ${suffix}`;
  const projectKey = `BUL${suffix}`.toUpperCase().slice(0, 10);

  await page.getByLabel("Project name").fill(projectName);
  await page.getByLabel("Key").fill(projectKey);
  await page.getByRole("button", { name: "Add project" }).click();
  await page.waitForTimeout(500);

  await page.getByText(projectName, { exact: false }).first().scrollIntoViewIfNeeded();
  const constitutionLink = page.locator(`#project-*`).first();
  void constitutionLink;

  // Find the project card by name and click its Constitution link.
  const projectHeading = page.getByRole("heading", { name: new RegExp(projectName) });
  const projectCard = projectHeading.locator("xpath=ancestor::div[contains(@id,'project-')]");
  await projectCard.getByRole("link", { name: "Constitution" }).click();
  await page.waitForURL(/\/projects\/.+\/constitution/);

  console.log("--- Setting a tiny budget ---");
  const budgetInput = page.getByLabel("AI budget ($)");
  console.log("budget input count:", await budgetInput.count());
  await budgetInput.fill("0.0001");
  console.log("input value after fill:", await budgetInput.inputValue());
  const [response] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("/ai-budget"), { timeout: 10000 }),
    page.getByRole("button", { name: "Save" }).click(),
  ]);
  console.log("ai-budget response status:", response.status(), await response.json());
  await page.waitForTimeout(500);
  await page.reload();
  console.log(await page.locator("text=Total AI drafting cost").textContent());

  console.log("--- Drafting (first draft should succeed, cost still under threshold at request time OR refused) ---");
  await page.getByRole("button", { name: "Draft with AI" }).click();
  await page.waitForFunction(
    () => document.body.innerText.includes("Approve") || document.body.innerText.includes("PENDING") || document.body.innerText.includes("blocked"),
    { timeout: 30000 }
  );
  await page.waitForTimeout(1000);
  await page.reload();

  const statusAfterFirst = await page.locator("body").innerText();
  console.log("Contains 'PENDING_APPROVAL' or similar:", statusAfterFirst.includes("PENDING") || statusAfterFirst.includes("DRAFT"));

  // Reject to allow redraft attempt, which should now be over budget.
  const rejectButton = page.getByRole("button", { name: "Reject" });
  if (await rejectButton.count() > 0) {
    await rejectButton.click();
    await page.waitForTimeout(800);
    await page.reload();
  }

  console.log("--- Page state before second draft attempt ---");
  console.log((await page.locator("body").innerText()).slice(0, 800));

  console.log("--- Second draft attempt (should be refused for budget) ---");
  const draftBtn = page.getByRole("button", { name: /draft with ai|redraft/i }).first();
  console.log("draft button count:", await draftBtn.count());
  if (await draftBtn.count() > 0) {
    await draftBtn.click();
    await page.waitForTimeout(1500);
    const bodyText = await page.locator("body").innerText();
    console.log("Shows budget blocked message:", bodyText.includes("AI drafting is blocked"));
    console.log("Shows Approve to continue button:", bodyText.includes("Approve to continue"));

    const approveBtn = page.getByRole("button", { name: /approve to continue/i });
    if (await approveBtn.count() > 0) {
      const [overrideRes] = await Promise.all([
        page.waitForResponse((r) => r.url().includes("/budget-override"), { timeout: 15000 }),
        approveBtn.click(),
      ]);
      console.log("budget-override response:", overrideRes.status(), await overrideRes.json());

      const retryRes = await page.waitForResponse((r) => r.url().includes("/constitution/draft"), { timeout: 15000 }).catch(() => null);
      if (retryRes) {
        console.log("retry draft response:", retryRes.status(), await retryRes.json().catch(() => null));
      } else {
        console.log("no retry draft response observed");
      }
      await page.waitForTimeout(2000);
    }
  }

  console.log("console errors:", consoleErrors);
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
