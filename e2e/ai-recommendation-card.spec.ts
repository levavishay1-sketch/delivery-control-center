import { test, expect } from "@playwright/test";

const ADMIN_EMAIL = "admin@example.com";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || "change-me-now";

/**
 * Slice 17 (ai-recommendation-card): create a WorkItem with no executor, verify the shared AI
 * Recommendation card renders on its Overview tab with a recommendation/why/assumptions/AI
 * estimate, click "Assign to AI", verify the executor updates and the card no longer renders.
 */
test("ai recommendation card: renders for an unassigned work item, assigning to AI removes it", async ({ page }) => {
  test.setTimeout(60_000);

  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(err.message));

  const suffix = Date.now().toString(36);
  const projectName = `Recommendation E2E ${suffix}`;
  const projectKey = `REC${suffix}`.toUpperCase().slice(0, 10);
  const workItemTitle = `Unassigned Item ${suffix}`;

  await page.goto("/login");
  await page.fill('input[name="email"]', ADMIN_EMAIL);
  await page.fill('input[name="password"]', ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("/");

  // --- Create the project and a work item (no executor set — defaults to UNASSIGNED) ---
  await page.getByLabel("Project name").fill(projectName);
  await page.getByLabel("Key").fill(projectKey);
  await page.getByRole("button", { name: "Add project" }).click();
  const projectHeading = page.getByRole("heading", { name: projectName });
  await expect(projectHeading).toBeVisible();
  const projectCard = page.locator("div.rounded-lg", { has: projectHeading });

  await projectCard.getByText("+ Add work item").click();
  await projectCard.getByPlaceholder("Work item title").fill(workItemTitle);
  await projectCard.getByRole("button", { name: "Create work item" }).click();
  await expect(projectCard.getByText(workItemTitle)).toBeVisible();

  // --- Open the item's 360° Record via Quick View ---
  await projectCard.locator("div", { hasText: workItemTitle }).last().getByRole("link", { name: "Quick View" }).click();
  await page.getByRole("dialog").getByRole("link", { name: "Open full 360° Record →" }).click();
  await page.waitForURL(/\/work-items\/.+\/360/);

  // --- The recommendation card renders with a verdict, why, and an AI estimate ---
  const card = page.getByLabel("AI recommendation");
  await expect(card).toBeVisible({ timeout: 10_000 });
  await expect(card.getByText(/^Recommended: /)).toBeVisible();
  await expect(card.getByText("If you choose AI")).toBeVisible();
  await expect(card.getByText("If you choose a developer instead")).toBeVisible();
  await expect(card.getByRole("button", { name: "Assign to AI" })).toBeVisible();
  await expect(card.getByRole("button", { name: "Assign to a developer" })).toBeVisible();

  // --- Assigning to AI updates the executor and the card no longer renders ---
  await card.getByRole("button", { name: "Assign to AI" }).click();
  await expect(page.getByText("AI Agent")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByLabel("AI recommendation")).toHaveCount(0);

  expect(consoleErrors, `Console errors: ${consoleErrors.join("\n")}`).toEqual([]);
});
