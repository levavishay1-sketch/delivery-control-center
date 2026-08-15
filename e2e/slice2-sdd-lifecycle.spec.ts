import { test, expect, type Locator, type Page } from "@playwright/test";

const ADMIN_EMAIL = "admin@example.com";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || "change-me-now";

/**
 * Full Slice 2 SDD lifecycle, end to end against the real dev server and the real job worker
 * (Task Group 11.1): draft/approve a project Constitution -> start a pipeline -> draft and
 * approve Spec -> draft Clarify, answer its question, watch it auto-resume and complete ->
 * draft and approve Plan and Tasks -> draft Analyze with a seeded Critical finding -> verify
 * advancement is blocked -> redraft the flagged stage and approve it -> re-run Analyze clean ->
 * verify advancement -> draft and approve Implement and Deploy through to pipeline completion ->
 * verify the audit trail and stage version history reflect the journey. No console errors.
 */
test("full SDD pipeline: Constitution, Clarify, Analyze block/resolve, through to completion", async ({ page }) => {
  test.setTimeout(150_000);

  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(err.message));

  const suffix = Date.now().toString(36);
  const projectName = `Slice2 Lifecycle ${suffix}`;
  const projectKey = `S2L${suffix}`.toUpperCase().slice(0, 10);
  const workItemTitle = `Lifecycle item ${suffix}`;

  // --- Login ---
  await page.goto("/login");
  await page.fill('input[name="email"]', ADMIN_EMAIL);
  await page.fill('input[name="password"]', ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("/");

  // --- Create the project ---
  await page.getByLabel("Project name").fill(projectName);
  await page.getByLabel("Key").fill(projectKey);
  await page.getByRole("button", { name: "Add project" }).click();

  const projectHeading = page.getByRole("heading", { name: projectName });
  await expect(projectHeading).toBeVisible();
  const projectCard = page.locator("div.rounded-lg", { has: projectHeading });
  const projectCardId = await projectCard.getAttribute("id");
  const projectId = projectCardId?.replace(/^project-/, "");
  if (!projectId) throw new Error(`Could not read project id from card element id: ${projectCardId}`);

  // --- Draft and approve the Constitution (Task Group 3 + 10) ---
  await projectCard.getByRole("link", { name: "Constitution" }).click();
  await page.waitForURL(/\/projects\/.+\/constitution/);
  await page.getByRole("button", { name: "Draft with AI" }).click();
  await expect(page.getByText("Awaiting gate approval")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.getByText("APPROVED", { exact: true })).toBeVisible({ timeout: 10_000 });

  // --- Create the work item (marker-engineered to trigger one Clarify question and one
  // Critical Analyze finding on PLAN, via the mock executor's deterministic test hooks) ---
  await page.getByRole("link", { name: "← Back to Dashboard" }).click();
  await page.waitForURL("/");
  await expect(projectHeading).toBeVisible();

  await projectCard.getByText("+ Add work item").click();
  await projectCard.getByPlaceholder("Work item title").fill(workItemTitle);
  await projectCard
    .getByPlaceholder("Description")
    .fill(
      "Full lifecycle item. [NEEDS_CLARIFICATION: Which email provider?] " +
        "[NEEDS_ANALYSIS_FINDING: CRITICAL:PLAN:Plan omits rollback steps for the migration]"
    );
  await projectCard.getByRole("button", { name: "Create work item" }).click();
  await expect(projectCard.getByText(workItemTitle)).toBeVisible();

  const workItemRow = projectCard.locator("div", { hasText: workItemTitle }).last();
  await workItemRow.getByRole("button", { name: "Start SDD" }).click();
  await workItemRow.getByRole("link", { name: workItemTitle }).click();
  await page.waitForURL(/\/pipelines\//);
  const workItemId = await extractWorkItemIdFrom360(page);

  // --- Helpers scoped to a stage's own card, keyed off its h2 label ---
  function stageCard(label: string): Locator {
    return page.locator("div.rounded-lg", { has: page.getByRole("heading", { name: label, level: 2, exact: true }) });
  }

  async function draftAndApprove(label: string, approveLabel: "Draft with AI" | "Redraft" = "Draft with AI") {
    const card = stageCard(label);
    await card.getByRole("button", { name: approveLabel }).click();
    await expect(card.getByText("Awaiting gate approval")).toBeVisible({ timeout: 15_000 });
    await card.getByRole("button", { name: "Approve", exact: true }).click();
    await expect(card.getByText("DONE", { exact: true })).toBeVisible({ timeout: 10_000 });
  }

  // --- Spec: draft, approve ---
  await draftAndApprove("Specification");

  // --- Clarify: draft (pauses), answer, watch it auto-resume and complete ---
  const clarifyCard = stageCard("Clarify");
  await clarifyCard.getByRole("button", { name: "Draft with AI" }).click();
  await expect(clarifyCard.getByText("Which email provider?")).toBeVisible({ timeout: 15_000 });
  await clarifyCard.getByPlaceholder("Your answer").fill("SendGrid");
  await clarifyCard.getByRole("button", { name: "Answer" }).click();
  // requiresApproval: false — completing auto-advances, no approval gate to click.
  await expect(clarifyCard.getByText("DONE", { exact: true })).toBeVisible({ timeout: 20_000 });

  // --- Plan, Tasks: draft, approve ---
  await draftAndApprove("Plan");
  await draftAndApprove("Tasks");

  // --- Analyze: draft with a seeded Critical finding — advancement must block ---
  const analyzeCard = stageCard("Analyze");
  await analyzeCard.getByRole("button", { name: "Draft with AI" }).click();
  await expect(analyzeCard.getByText("REJECTED", { exact: true })).toBeVisible({ timeout: 15_000 });
  const findingsPanel = analyzeCard.locator('[aria-label="Analyze findings"]');
  await expect(findingsPanel.getByText(/CRITICAL \(1\)/)).toBeVisible();
  await expect(findingsPanel.getByText("Plan omits rollback steps for the migration")).toBeVisible();
  await expect(page.getByText("BLOCKED", { exact: true })).toBeVisible();

  // --- Redraft the flagged Plan stage (allowed even though it's DONE and not current) ---
  const planCard = stageCard("Plan");
  await expect(planCard.getByText(/Flagged by Analyze/)).toBeVisible();
  await planCard.getByRole("button", { name: "Redraft" }).click();
  await expect(planCard.getByText("Awaiting gate approval")).toBeVisible({ timeout: 15_000 });
  await planCard.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(planCard.getByText("DONE", { exact: true })).toBeVisible({ timeout: 10_000 });

  // Approving the redraft must not disturb Tasks (no duplicate stage, no backward jump).
  await expect(stageCard("Tasks").getByText("DONE", { exact: true })).toBeVisible();
  await expect(page.getByText("BLOCKED", { exact: true })).toBeVisible();

  // --- Clear the underlying issue and re-run Analyze clean ---
  await page.request.patch(`/api/work-items/${workItemId}`, {
    data: { description: "Full lifecycle item. Rollback plan added to the Plan stage." },
  });
  await analyzeCard.getByRole("button", { name: "Redraft" }).click();
  // Both the raw draft content and the findings panel say this — .first() is fine, this is an
  // existence check, not a scoping concern.
  await expect(analyzeCard.getByText("No consistency issues found.").first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("BLOCKED", { exact: true })).not.toBeVisible();

  // --- Implement, Deploy: draft, approve through to completion ---
  await draftAndApprove("Implement");
  await draftAndApprove("Deploy");
  await expect(page.getByText("COMPLETED", { exact: true })).toBeVisible({ timeout: 10_000 });

  // --- Stage version history reflects the Plan redraft ---
  await expect(planCard.getByText("Version history (2)")).toBeVisible();

  // --- Audit trail reflects the journey — filtered to this fresh project, so each assertion
  // matches exactly this run's events, not similar rows from other E2E specs sharing the DB.
  await page.goto(`/audit?project=${projectId}&pageSize=100`);
  await expect(page.getByText(/approved Constitution v1/i)).toBeVisible();
  await expect(page.getByText(/started the pipeline/i)).toBeVisible();
  await expect(page.getByText(/AI asked 1 clarifying question/i)).toBeVisible();
  await expect(page.getByText(/Critical, blocking advancement/i)).toBeVisible();
  await expect(page.getByText(/Pipeline completed/i)).toBeVisible();

  expect(consoleErrors, `Unexpected console errors: ${consoleErrors.join("\n")}`).toEqual([]);
});

/** The pipeline detail page links to the work item's 360 view; scrape the id from that href. */
async function extractWorkItemIdFrom360(page: Page): Promise<string> {
  const href = await page.getByRole("link", { name: "360° Record →" }).getAttribute("href");
  const match = href?.match(/\/work-items\/([^/]+)\/360/);
  if (!match) throw new Error(`Could not extract work item id from 360 link href: ${href}`);
  return match[1];
}
