import { test, expect } from "@playwright/test";

const ADMIN_EMAIL = "admin@example.com";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || "change-me-now";

/**
 * Slice 6 Configuration Center end-to-end (Task Group 6.1): an org admin sets an Organization
 * budget, sees the impact preview, confirms, and sees a client with no override of its own now
 * report that value as its effective (inherited) budget. The org admin then sets a Client-level
 * override, previews and confirms, and sees a project under it (no override) report the client's
 * value instead. A write-capable user (the same org admin here — no separate write-only fixture
 * exists in the seed data) then sets that project's own override directly (no preview, per
 * design.md decision 4), sees it reported as an override, resets it to inherited, and sees it
 * fall back to the client's value. Each scope's history list reflects every change made.
 */
test("configuration center: organization -> client -> project budget inheritance, preview, and history", async ({ page }) => {
  test.setTimeout(90_000);

  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(err.message));

  const suffix = Date.now().toString(36);

  // --- Login as the org admin ---
  await page.goto("/login");
  await page.fill('input[name="email"]', ADMIN_EMAIL);
  await page.fill('input[name="password"]', ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("/");

  // --- Organization scope: set a budget, see the impact preview, confirm ---
  await page.getByRole("link", { name: /configuration/i }).first().click();
  await page.waitForURL(/\/organizations\/.+\/config/);

  const orgBudgetSection = page.locator("section", { has: page.getByRole("heading", { name: "AI Budget" }) });
  await orgBudgetSection.getByLabel("AI budget ($)").fill("123.45");
  await orgBudgetSection.getByRole("button", { name: "Preview" }).click();
  await expect(orgBudgetSection.getByText("Set the organization budget to $123.45")).toBeVisible();
  await expect(orgBudgetSection.getByText(/Affects \d+ client|No clients or projects currently inherit/)).toBeVisible();

  await orgBudgetSection.getByRole("button", { name: "Confirm" }).click();
  await expect(orgBudgetSection.getByText(/Effective budget:\s*\$123\.45/)).toBeVisible({ timeout: 10_000 });

  const orgHistorySection = page.locator("section", { has: page.getByRole("heading", { name: "Budget History" }) });
  // History is append-only, so repeated runs against the same database can leave more than
  // one matching entry — assert the most recent (first, since it renders newest-first).
  await expect(orgHistorySection.getByText(/No limit\s*→\s*\$123\.45/).first()).toBeVisible();

  // --- Back to the Dashboard: the Default Client has no override, so it now inherits $123.45 ---
  await page.getByRole("link", { name: "← Back to Dashboard" }).click();
  await page.waitForURL("/");

  const clientHeading = page.getByRole("heading", { name: "Default Client" });
  const clientSection = page.locator("section", { has: clientHeading });
  await expect(clientSection.getByText(/Effective budget:\s*\$123\.45/)).toBeVisible();
  await expect(clientSection.getByText(/inherited from organization/)).toBeVisible();

  // --- Client scope: set an override, preview, confirm ---
  await clientSection.getByLabel("AI budget ($)").fill("50");
  await clientSection.getByRole("button", { name: "Preview" }).click();
  await expect(clientSection.getByText("Set the client budget to $50")).toBeVisible();
  await expect(clientSection.getByText(/Affects \d+ client|No clients or projects currently inherit/)).toBeVisible();

  await clientSection.getByRole("button", { name: "Confirm" }).click();
  await expect(clientSection.getByText(/Effective budget:\s*\$50\b/)).toBeVisible({ timeout: 10_000 });
  await expect(clientSection.getByText(/own override/)).toBeVisible();

  await clientSection.locator("summary", { hasText: "Budget history" }).click();
  // Append-only history: repeated runs against the same database can leave more than one
  // matching entry — assert the most recent (first, since it renders newest-first).
  await expect(clientSection.getByText(/No limit\s*→\s*\$50/).first()).toBeVisible();

  // --- Create a fresh project under Default Client (no override of its own) ---
  const projectName = `Config Test Project ${suffix}`;
  const projectKey = `CFG${suffix}`.toUpperCase().slice(0, 10);
  await page.getByLabel("Client").selectOption({ label: "Default Client" });
  await page.getByLabel("Project name").fill(projectName);
  await page.getByLabel("Key").fill(projectKey);
  await page.getByRole("button", { name: "Add project" }).click();

  const projectHeading = page.getByRole("heading", { name: projectName });
  await expect(projectHeading).toBeVisible();
  const projectCard = page.locator("div.rounded-lg", { has: projectHeading });
  await projectCard.getByRole("link", { name: "Constitution" }).click();
  await page.waitForURL(/\/projects\/.+\/constitution/);

  // --- Project inherits the client's $50 ---
  await expect(page.getByText(/Effective budget:\s*\$50\b/)).toBeVisible();
  await expect(page.getByText(/inherited from client/)).toBeVisible();

  // --- Project scope: set its own override directly, no preview step ---
  await page.getByLabel("AI budget ($)").fill("10");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText(/Effective budget:\s*\$10\b/)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/own override/)).toBeVisible();

  // --- Reset to inherited: falls back to the client's $50 ---
  await page.getByRole("button", { name: "Reset to inherited" }).click();
  await expect(page.getByText(/Effective budget:\s*\$50\b/)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/inherited from client/)).toBeVisible();

  // --- The project's history reflects both changes ---
  await page.locator("summary", { hasText: "Budget history" }).click();
  await expect(page.getByText(/No limit\s*→\s*\$10/)).toBeVisible();
  await expect(page.getByText(/\$10\s*→\s*No limit/)).toBeVisible();

  // --- Verify no console errors ---
  expect(consoleErrors).toHaveLength(0);
});
