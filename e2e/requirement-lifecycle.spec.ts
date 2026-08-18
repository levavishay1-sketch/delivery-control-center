import { test, expect } from "@playwright/test";

const ADMIN_EMAIL = "admin@example.com";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || "change-me-now";

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.fill('input[name="email"]', ADMIN_EMAIL);
  await page.fill('input[name="password"]', ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("/");
}

/**
 * Slice 15 (requirement-lifecycle-foundation): create a client, add a standalone Requirement
 * from its Clients-hub detail page, start SDD on it, and confirm a Project + root WorkItem now
 * exist and the Requirement shows SDD_ACTIVE linked to that WorkItem.
 */
test("standalone Requirement: create → Start SDD → Project + WorkItem materialize", async ({ page }) => {
  test.setTimeout(120_000);

  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(err.message));

  const suffix = Date.now().toString(36);
  const clientName = `Requirement Client ${suffix}`;
  const clientSlug = `requirement-client-${suffix}`;
  const requirementTitle = `Improve onboarding ${suffix}`;

  await login(page);

  // --- Create a client to hold the Requirement ---
  await page.goto("/clients");
  await page.getByLabel("Client name").fill(clientName);
  await page.getByLabel("Slug").fill(clientSlug);
  await page.getByRole("button", { name: "Add client" }).click();
  await expect(page.getByText(clientName)).toBeVisible();
  await page.getByText(clientName).click();
  await page.waitForURL(/\/clients\/.+/);

  // --- Create a standalone Requirement ---
  await page.getByLabel("Title", { exact: true }).fill(requirementTitle);
  await page.getByRole("button", { name: "Add Requirement" }).click();
  await expect(page.getByText(requirementTitle)).toBeVisible();
  await expect(page.getByText("TASK · Standalone")).toBeVisible();

  // --- Open its detail page ---
  await page.getByText(requirementTitle).click();
  await page.waitForURL(/\/requirements\/.+/);
  await expect(page.getByRole("heading", { name: requirementTitle })).toBeVisible();
  await expect(page.getByText("Standalone — no Project linked yet")).toBeVisible();

  // --- Start SDD ---
  await page.getByRole("button", { name: "Start SDD" }).click();
  await expect(page.getByText("SDD_ACTIVE", { exact: true })).toBeVisible();

  // --- A Project link and the created WorkItem now appear ---
  const projectLink = page.locator('a[href^="/projects/"]');
  await expect(projectLink).toBeVisible();
  const workItemLink = page.locator('a[href*="/work-items/"]');
  await expect(workItemLink).toBeVisible();
  await expect(workItemLink).toHaveText(requirementTitle);

  // --- Starting SDD again is no longer offered ---
  await expect(page.getByRole("button", { name: "Start SDD" })).toHaveCount(0);

  expect(consoleErrors, `Console errors: ${consoleErrors.join("\n")}`).toEqual([]);
});
