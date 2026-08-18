import { execFileSync } from "node:child_process";
import { test, expect } from "@playwright/test";

const ADMIN_EMAIL = "admin@example.com";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || "change-me-now";

function runFixture(...args: string[]): Record<string, string> {
  const output = execFileSync("npx", ["tsx", "e2e/fixtures/seedModelSnapshot.ts", ...args], { encoding: "utf-8" });
  return output.trim() ? JSON.parse(output) : {};
}

async function createProjectAndAssignToAi(page: import("@playwright/test").Page, suffix: string) {
  const projectName = `Model Snapshot E2E ${suffix}`;
  const projectKey = `MSE${suffix}`.toUpperCase().slice(0, 10);
  const workItemTitle = `AI-Executed Item ${suffix}`;

  await page.goto("/login");
  await page.fill('input[name="email"]', ADMIN_EMAIL);
  await page.fill('input[name="password"]', ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("/");

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

  await projectCard.locator("div", { hasText: workItemTitle }).last().getByRole("link", { name: "Quick View" }).click();
  await page.getByRole("dialog").getByRole("link", { name: "Open full 360° Record →" }).click();
  await page.waitForURL(/\/work-items\/.+\/360/);

  await page.getByLabel("AI recommendation").getByRole("button", { name: "Assign to AI" }).click();
  await expect(page.getByText("AI Agent")).toBeVisible({ timeout: 10_000 });
}

/**
 * Slice 20 (ai-model-knowledge-snapshot): seeds a ModelSnapshot directly via a standalone `tsx`
 * fixture script — a real weekly fetch against the live external page is not suitable for E2E,
 * and Playwright's own bundler cannot import the Prisma client directly (see the fixture script's
 * comment) — assigns a WorkItem's executor to AI via Slice 17's existing executor-recommendation
 * card, then verifies the model recommendation card renders with the recommended model, why,
 * assumptions, estimate, and the seeded snapshot's freshness visible.
 */
test("ai model knowledge snapshot: model recommendation card shows a snapshot-grounded recommendation", async ({ page }) => {
  test.setTimeout(60_000);

  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(err.message));

  const { agentModel, snapshotId } = runFixture("create");

  try {
    const suffix = Date.now().toString(36);
    await createProjectAndAssignToAi(page, suffix);

    const card = page.getByLabel("AI recommendation");
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(card.getByText(`Recommended: ${agentModel}`)).toBeVisible();
    await expect(card.getByText(/^As of /)).toBeVisible();
    await expect(card.getByText(/\$3 per million tokens/).first()).toBeVisible();
    await expect(card.getByText("Estimated AI execution")).toBeVisible();

    expect(consoleErrors, `Console errors: ${consoleErrors.join("\n")}`).toEqual([]);
  } finally {
    runFixture("delete", snapshotId);
  }
});

/**
 * Fallback path: no successful snapshot exists yet, so the card confirms the configured model
 * using the system's built-in defaults rather than fabricating a snapshot date.
 */
test("ai model knowledge snapshot: falls back to built-in defaults when no snapshot exists yet", async ({ page }) => {
  test.setTimeout(60_000);

  const { agentModel } = runFixture("clear");

  const suffix = Date.now().toString(36);
  await createProjectAndAssignToAi(page, suffix);

  const card = page.getByLabel("AI recommendation");
  await expect(card).toBeVisible({ timeout: 10_000 });
  await expect(card.getByText(`Recommended: ${agentModel}`)).toBeVisible();
  await expect(card.getByText("No knowledge snapshot yet — using built-in defaults")).toBeVisible();
});
