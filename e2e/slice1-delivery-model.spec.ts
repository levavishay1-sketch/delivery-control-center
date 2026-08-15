import { test, expect } from "@playwright/test";

const ADMIN_EMAIL = "admin@example.com";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || "change-me-now";

/**
 * Slice 1 end-to-end scenario: create project -> create two work items -> add a
 * dependency between them -> create a blocker -> verify it surfaces in the
 * Attention Center -> open Quick View -> resolve the blocker from the drawer ->
 * verify the Timeline and Audit Trail both reflect the change.
 *
 * Deviation from the task list's literal step 2 ("create a new client"): this
 * codebase has no client-creation UI or API route — GET /api/clients is the only
 * client endpoint that exists, and Slice 0 never built a create-client flow for
 * the UI to drive. Creating one here would be scope creep into an earlier slice's
 * gap, not a Slice 1 E2E concern. Uses the seeded "Default Client" instead (the
 * same one the existing smoke.spec.ts relies on).
 */
test("delivery model: dependency, blocker, Attention Center, Quick View, timeline, audit trail", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(err.message));

  const suffix = Date.now().toString(36);
  const projectKey = `S1E2E${suffix}`.toUpperCase().slice(0, 10);
  const projectName = `Slice1 E2E ${suffix}`;
  const backendApiTitle = `Backend API ${suffix}`;
  const databaseSchemaTitle = `Database Schema ${suffix}`;
  const blockerReason = `Waiting for DBA review ${suffix}`;

  // 1. Log in.
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
  await page.fill('input[name="email"]', ADMIN_EMAIL);
  await page.fill('input[name="password"]', ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("/");

  // 2-3. Create a project (in the seeded Default Client — see deviation note above).
  await page.getByLabel("Project name").fill(projectName);
  await page.getByLabel("Key").fill(projectKey);
  await page.getByRole("button", { name: "Add project" }).click();

  const projectHeading = page.getByRole("heading", { name: projectName });
  await expect(projectHeading).toBeVisible();
  const projectCard = page.locator("div.rounded-lg", { has: projectHeading });

  // 4. Create two work items. Neither gets a pipeline here — Slice 2 made pipeline start an
  // explicit action, and this scenario is about dependency/blocker/timeline/audit, not the SDD
  // pipeline, so it doesn't start one.
  for (const title of [backendApiTitle, databaseSchemaTitle]) {
    await projectCard.getByText("+ Add work item").click();
    await projectCard.getByPlaceholder("Work item title").fill(title);
    await projectCard.getByRole("button", { name: "Create work item" }).click();
    await expect(projectCard.getByText(title)).toBeVisible();
  }

  // Navigate to Backend API's 360° Record via Quick View (works whether or not a pipeline exists).
  const backendApiRow = projectCard.locator("div", { hasText: backendApiTitle }).last();
  await backendApiRow.getByRole("link", { name: "Quick View" }).click();
  const quickView = page.getByRole("dialog");
  await expect(quickView).toBeVisible();
  await quickView.getByRole("link", { name: "Open full 360° Record →" }).click();
  await page.waitForURL(/\/work-items\/.+\/360/);
  await expect(page.getByRole("heading", { name: backendApiTitle })).toBeVisible();

  // 5. Add a dependency: Backend API depends on Database Schema.
  await page.getByRole("tab", { name: "Dependencies" }).click();
  await page.getByRole("button", { name: "+ Add Dependency" }).click();
  await page.locator("select").filter({ hasText: databaseSchemaTitle }).selectOption({ label: databaseSchemaTitle });
  await page.getByPlaceholder("Reason for the dependency").fill("Backend API depends on Database Schema");
  await page.getByRole("button", { name: "Add Dependency", exact: true }).click();
  // Database Schema has no pipeline (neither work item started one in this scenario), so
  // DependenciesTab renders it as plain text rather than a link to its pipeline. Scoped to
  // the "Depends on" section since the title also appears (hidden) in the form's own <option>.
  const dependsOnSection = page.locator("section", { has: page.getByRole("heading", { name: "Depends on" }) });
  await expect(dependsOnSection.getByText(databaseSchemaTitle)).toBeVisible();

  // 6. Create a blocker on Backend API.
  await page.getByRole("tab", { name: "Overview" }).click();
  await page.getByRole("button", { name: "Create Blocker" }).click();
  await page.getByPlaceholder("Reason (why is this blocked?)").fill(blockerReason);
  await page.getByPlaceholder("Required action (what needs to happen?)").fill("Get DBA sign-off");
  await page.getByRole("button", { name: "Create Blocker", exact: true }).click();
  await expect(page.getByText("Blocked", { exact: true })).toBeVisible();
  await expect(page.getByText(blockerReason)).toBeVisible();

  // 7. Navigate to Attention Center, verify the blocker is shown with its reason.
  await page.getByRole("link", { name: "Attention Center" }).click();
  await page.waitForURL(/\/attention/);
  await expect(page.getByText(blockerReason)).toBeVisible();

  // 8. Open Quick View from the Attention Center row, verify the blocker panel.
  const blockerRow = page
    .locator("div", { hasText: blockerReason })
    .filter({ has: page.getByRole("link", { name: "Quick View" }) })
    .last();
  await blockerRow.getByRole("link", { name: "Quick View" }).click();
  const drawer = page.getByRole("dialog");
  await expect(drawer).toBeVisible();
  // Scoped to the blocker panel itself (not the whole drawer) — the Timeline section
  // below it also renders the reason inside the raw audit-event JSON, which would
  // otherwise make this locator ambiguous.
  const blockerPanel = drawer.getByTestId("blocker-panel");
  await expect(blockerPanel.getByText("Blocked", { exact: true })).toBeVisible();
  await expect(blockerPanel.getByText(blockerReason)).toBeVisible();

  // 9. Resolve the blocker via Quick View.
  await drawer.getByRole("button", { name: "Resolve Blocker" }).click();
  await expect(blockerPanel).not.toBeVisible({ timeout: 10_000 });

  // 10. Verify the drawer's own Timeline shows the resolution event (no page reload).
  await expect(drawer.getByText(`resolved blocker on "${backendApiTitle}"`)).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(drawer).not.toBeVisible();

  // 11. Verify the Audit Trail shows both the blocker creation and resolution events.
  await page.getByRole("link", { name: "Audit Trail" }).click();
  await page.waitForURL(/\/audit/);
  await expect(page.getByText(`created blocker on "${backendApiTitle}": ${blockerReason}`)).toBeVisible();
  await expect(page.getByText(`resolved blocker on "${backendApiTitle}"`)).toBeVisible();

  expect(consoleErrors, `Unexpected console errors:\n${consoleErrors.join("\n")}`).toHaveLength(0);
});
