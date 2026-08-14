import { test, expect } from "@playwright/test";

const ADMIN_EMAIL = "admin@example.com";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || "change-me-now";

/**
 * Full happy-path smoke test: login -> create project -> create work item ->
 * draft the first stage with AI -> approve it. Assumes the seed script has
 * already run (creates the org-admin user and a default client).
 */
test("login, create project, create work item, draft, and approve", async ({ page }) => {
  const suffix = Date.now().toString(36);
  const projectKey = `E2E${suffix}`.toUpperCase().slice(0, 10);

  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);

  await page.fill('input[name="email"]', ADMIN_EMAIL);
  await page.fill('input[name="password"]', ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("/");

  await page.getByLabel("Project name").fill(`E2E Smoke Test ${suffix}`);
  await page.getByLabel("Key").fill(projectKey);
  await page.getByRole("button", { name: "Add project" }).click();

  const projectHeading = page.getByRole("heading", { name: `E2E Smoke Test ${suffix}` });
  await expect(projectHeading).toBeVisible();
  const projectCard = page.locator("div.rounded-lg", { has: projectHeading });

  await projectCard.getByText("+ Add work item").click();
  await projectCard.getByPlaceholder("Work item title").fill("Smoke test work item");
  await projectCard.getByRole("button", { name: "Create + start pipeline" }).click();

  const workItemLink = projectCard.getByRole("link", { name: "Smoke test work item" });
  await expect(workItemLink).toBeVisible();
  await workItemLink.click();

  await page.waitForURL(/\/pipelines\//);
  await expect(page.getByRole("heading", { name: "Smoke test work item" })).toBeVisible();

  await page.getByRole("button", { name: "Draft with AI" }).click();
  await expect(page.getByText("Awaiting gate approval")).toBeVisible({ timeout: 15_000 });

  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.getByText("Awaiting gate approval")).not.toBeVisible();
  await expect(page.getByText("Org Admin — approved")).toBeVisible();
});
