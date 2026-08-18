import { test, expect, type Locator } from "@playwright/test";

const ADMIN_EMAIL = "admin@example.com";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || "change-me-now";

/**
 * Slice 18 (task-decomposition-materialization): drive a WorkItem's pipeline through to an
 * approved TASKS stage, verify its structured task drafts render, materialize a subset, and
 * confirm the resulting child WorkItem appears on the parent's 360° Record.
 */
test("task decomposition: approved TASKS stage drafts materialize into child WorkItems", async ({ page }) => {
  test.setTimeout(120_000);

  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(err.message));

  const suffix = Date.now().toString(36);
  const projectName = `Task Decomp ${suffix}`;
  const projectKey = `TDC${suffix}`.toUpperCase().slice(0, 10);
  const workItemTitle = `Decompose me ${suffix}`;

  await page.goto("/login");
  await page.fill('input[name="email"]', ADMIN_EMAIL);
  await page.fill('input[name="password"]', ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("/");

  // --- Create the project and approve its Constitution ---
  await page.getByLabel("Project name").fill(projectName);
  await page.getByLabel("Key").fill(projectKey);
  await page.getByRole("button", { name: "Add project" }).click();
  const projectHeading = page.getByRole("heading", { name: projectName });
  await expect(projectHeading).toBeVisible();
  const projectCard = page.locator("div.rounded-lg", { has: projectHeading });

  await projectCard.getByRole("link", { name: "Constitution" }).click();
  await page.waitForURL(/\/projects\/.+\/constitution/);
  await page.getByRole("button", { name: "Draft with AI" }).click();
  await expect(page.getByText("Awaiting gate approval")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.getByText("APPROVED", { exact: true })).toBeVisible({ timeout: 10_000 });

  // --- Create the work item (description marker-engineers deterministic TASKS drafts) ---
  await page.getByRole("link", { name: "← Back to Dashboard" }).click();
  await page.waitForURL("/");
  await expect(projectHeading).toBeVisible();

  await projectCard.getByText("+ Add work item").click();
  await projectCard.getByPlaceholder("Work item title").fill(workItemTitle);
  await projectCard
    .getByPlaceholder("Description")
    .fill(`Decomposition test item. [NEEDS_TASK_DRAFTS: Build the migration | Wire the API route]`);
  await projectCard.getByRole("button", { name: "Create work item" }).click();
  await expect(projectCard.getByText(workItemTitle)).toBeVisible();

  const workItemRow = projectCard.locator("div", { hasText: workItemTitle }).last();
  await workItemRow.getByRole("button", { name: "Start SDD" }).click();
  await workItemRow.getByRole("link", { name: workItemTitle }).click();
  await page.waitForURL(/\/pipelines\//);

  function stageCard(label: string): Locator {
    return page.locator("div.rounded-lg", { has: page.getByRole("heading", { name: label, level: 2, exact: true }) });
  }

  async function draftAndApprove(label: string) {
    const card = stageCard(label);
    await card.getByRole("button", { name: "Draft with AI" }).click();
    await expect(card.getByText("Awaiting gate approval")).toBeVisible({ timeout: 15_000 });
    await card.getByRole("button", { name: "Approve", exact: true }).click();
    await expect(card.getByText("DONE", { exact: true })).toBeVisible({ timeout: 10_000 });
  }

  // --- Drive SPEC -> CLARIFY -> PLAN -> TASKS ---
  await draftAndApprove("Specification");

  const clarifyCard = stageCard("Clarify");
  await clarifyCard.getByRole("button", { name: "Draft with AI" }).click();
  await expect(clarifyCard.getByText("DONE", { exact: true })).toBeVisible({ timeout: 20_000 });

  await draftAndApprove("Plan");

  const tasksCard = stageCard("Tasks");
  await tasksCard.getByRole("button", { name: "Draft with AI" }).click();
  await expect(tasksCard.getByText("Awaiting gate approval")).toBeVisible({ timeout: 15_000 });

  // --- Task drafts are visible before approval, but no materialize action yet (not DONE) ---
  await expect(tasksCard.getByText("Build the migration")).toBeVisible();
  await expect(tasksCard.getByText("Wire the API route")).toBeVisible();
  await expect(tasksCard.getByRole("button", { name: /Materialize Selected/ })).toHaveCount(0);

  await tasksCard.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(tasksCard.getByText("DONE", { exact: true })).toBeVisible({ timeout: 10_000 });

  // --- Materialize one of the two drafts ---
  await tasksCard.getByLabel('Select "Build the migration" for materialization').check();
  await tasksCard.getByRole("button", { name: /Materialize Selected \(1\)/ }).click();
  await expect(tasksCard.getByRole("link", { name: "View Work Item →" })).toBeVisible({ timeout: 10_000 });

  // --- The other draft remains un-materialized, still selectable ---
  await expect(tasksCard.getByLabel('Select "Wire the API route" for materialization')).toBeVisible();

  // --- The materialized draft's WorkItem appears as a child on the parent's 360° Record ---
  await page.getByRole("link", { name: "360° Record →" }).click();
  await page.waitForURL(/\/work-items\/.+\/360/);
  await expect(page.getByText(/Build the migration.*OPEN/)).toBeVisible();

  expect(consoleErrors, `Console errors: ${consoleErrors.join("\n")}`).toEqual([]);
});
