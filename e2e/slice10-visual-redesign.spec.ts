import { test, expect } from "@playwright/test";

const ADMIN_EMAIL = "admin@example.com";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || "change-me-now";

/**
 * Slice 10 product-visual-redesign end-to-end scenario (Task 14.3): the redesigned application
 * shell — branded sidebar + white rounded workspace container (design.md decision 6) — renders
 * on the Dashboard and on Pipeline Detail, a legacy Slice 2 page that predates this redesign and
 * was migrated to the new `Panel`-based markup (Task Group 9) rather than rebuilt from scratch.
 * Confirms the redesign reached beyond the Dashboard into the rest of the product.
 */
test("visual redesign: branded shell renders on the Dashboard and on a migrated legacy page (Pipeline Detail)", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(err.message));

  const suffix = Date.now().toString(36);
  const projectKey = `S10E2E${suffix}`.toUpperCase().slice(0, 10);
  const projectName = `Slice10 E2E ${suffix}`;
  const workItemTitle = `Shell check item ${suffix}`;

  await page.goto("/login");
  await page.fill('input[name="email"]', ADMIN_EMAIL);
  await page.fill('input[name="password"]', ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("/");

  // --- Dashboard: branded sidebar + white rounded workspace container both present ---
  const sidebar = page.getByRole("navigation", { name: "Primary" });
  await expect(sidebar).toBeVisible();
  await expect(sidebar.getByText("Delivery Control")).toBeVisible();
  await expect(page.locator("main.rounded-shell")).toBeVisible();

  // --- Create a project + work item, start its pipeline, and reach Pipeline Detail ---
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

  const workItemRow = projectCard.locator("div", { hasText: workItemTitle }).last();
  await workItemRow.getByRole("button", { name: "Start SDD" }).click();
  await workItemRow.getByRole("link", { name: workItemTitle }).click();
  await page.waitForURL(/\/pipelines\//);

  // --- Pipeline Detail (legacy Slice 2 page, migrated in Task Group 9): same shell present ---
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
  await expect(page.locator("main.rounded-shell")).toBeVisible();
  // Its stage cards render as `Panel`s (Task 9.1) carrying the `data-stage-id` E2E hook.
  await expect(page.locator("[data-stage-id]").first()).toBeVisible();

  expect(consoleErrors).toHaveLength(0);
});
