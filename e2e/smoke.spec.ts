import { test, expect } from "@playwright/test";

const ADMIN_EMAIL = "admin@example.com";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || "change-me-now";

const SEEDED_PROJECT_NAME = "Delivery Control Center Demo";

/**
 * Full happy-path smoke test: login -> create project -> create work item ->
 * verify Start SDD is refused without an approved Constitution -> start a
 * pipeline on a work item under the seeded project (which has one from the
 * seed script) -> draft the first stage with AI -> approve it. Assumes the
 * seed script has already run (creates the org-admin user, default client,
 * and an approved Constitution for the demo project).
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
  await projectCard.getByRole("button", { name: "Create work item" }).click();
  await expect(projectCard.getByText("Smoke test work item")).toBeVisible();

  // This fresh project has no Constitution yet, so Start SDD is refused.
  const workItemRow = projectCard.locator("div", { hasText: "Smoke test work item" }).last();
  await workItemRow.getByRole("button", { name: "Start SDD" }).click();
  await expect(workItemRow.getByText(/no approved Constitution/i)).toBeVisible();

  // The seeded demo project already has an approved Constitution (from prisma/seed.ts), so a
  // new work item under it can start a pipeline immediately, exercising the full draft/approve
  // gate flow without needing the Constitution-drafting UI (that's Task Group 10's job).
  const seededProjectHeading = page.getByRole("heading", { name: SEEDED_PROJECT_NAME });
  await expect(seededProjectHeading).toBeVisible();
  const seededProjectCard = page.locator("div.rounded-lg", { has: seededProjectHeading });

  const draftableTitle = `Draftable item ${suffix}`;
  await seededProjectCard.getByText("+ Add work item").click();
  await seededProjectCard.getByPlaceholder("Work item title").fill(draftableTitle);
  await seededProjectCard.getByRole("button", { name: "Create work item" }).click();

  const draftableRow = seededProjectCard.locator("div", { hasText: draftableTitle }).last();
  await draftableRow.getByRole("button", { name: "Start SDD" }).click();
  await expect(draftableRow.getByRole("link", { name: draftableTitle })).toBeVisible();
  await draftableRow.getByRole("link", { name: draftableTitle }).click();

  await page.waitForURL(/\/pipelines\//);
  await expect(page.getByRole("heading", { name: draftableTitle })).toBeVisible();

  await page.getByRole("button", { name: "Draft with AI" }).click();
  await expect(page.getByText("Awaiting gate approval")).toBeVisible({ timeout: 15_000 });

  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.getByText("Awaiting gate approval")).not.toBeVisible();
  await expect(page.getByText("Org Admin — approved")).toBeVisible();
});
