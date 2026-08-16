import { test, expect } from "@playwright/test";

const ADMIN_EMAIL = "admin@example.com";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || "change-me-now";
const VIEWER_EMAIL = "viewer@example.com";
const VIEWER_PASSWORD = process.env.SEED_ADMIN_PASSWORD || "change-me-now";

async function login(page: import("@playwright/test").Page, email: string, password: string) {
  await page.goto("/login");
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("/");
  // Wait for client hydration (CommandPalette's keydown listener attaches on mount) before any
  // keyboard shortcut is sent, not just the URL change.
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
}

/**
 * Presses Ctrl+K and retries until the palette dialog appears. A single press can land before
 * CommandPalette's keydown listener has attached post-hydration (a dev-server timing race, not
 * a product bug), so this absorbs that instead of hard-failing on the first missed keystroke.
 */
async function openCommandPalette(page: import("@playwright/test").Page) {
  const palette = page.getByRole("dialog", { name: "Search work items and projects…" });
  await expect(async () => {
    if (await palette.isVisible()) return;
    await page.keyboard.press("Control+k");
    await expect(palette).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  return palette;
}

/**
 * Slice 9 dashboard-motifs-refresh end-to-end scenarios (Task Group 9.2/9.3):
 * StatTile presence/linking on the Dashboard and Attention Center, the
 * BudgetUsageMeter's conditional presence, and the command palette's search +
 * navigate + tenancy-isolation behavior. Reuses the seeded "Client B
 * (isolation fixture)" client and "viewer@example.com" user from
 * `e2e/isolation.spec.ts` rather than creating new fixtures.
 */

test("stat tiles render on the Dashboard and Attention Center and link to the correct section", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(err.message));

  const suffix = Date.now().toString(36);
  const projectKey = `S9E2E${suffix}`.toUpperCase().slice(0, 10);
  const projectName = `Slice9 E2E ${suffix}`;
  const workItemTitle = `Stat tile item ${suffix}`;
  const blockerReason = `Blocking for stat tile check ${suffix}`;

  await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);

  // Create a project + work item, then block it, so the "Blockers" stat tile is guaranteed
  // non-zero (mirrors the blocker-creation flow from e2e/slice1-delivery-model.spec.ts).
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
  await workItemRow.getByRole("link", { name: "Quick View" }).click();
  const quickView = page.getByRole("dialog");
  await expect(quickView).toBeVisible();
  await quickView.getByRole("link", { name: "Open full 360° Record →" }).click();
  await page.waitForURL(/\/work-items\/.+\/360/);

  await page.getByRole("button", { name: "Create Blocker" }).click();
  await page.getByPlaceholder("Reason (why is this blocked?)").fill(blockerReason);
  await page.getByPlaceholder("Required action (what needs to happen?)").fill("Unblock it");
  await page.getByRole("button", { name: "Create Blocker", exact: true }).click();
  await expect(page.getByText("Blocked", { exact: true })).toBeVisible();

  // Dashboard: the "Blockers" StatTile shows a non-zero count and links to /attention#blockers.
  await page.getByRole("link", { name: "Dashboard", exact: true }).click();
  await page.waitForURL("/");
  // StatTile's count-up animation starts from 0 on mount (Task 2.3), so assert with an
  // auto-retrying locator matcher rather than a one-shot innerText() read.
  const dashboardBlockersTile = page.getByRole("link", { name: /Blockers/ });
  await expect(dashboardBlockersTile).toBeVisible();
  await expect(dashboardBlockersTile).toHaveAttribute("href", "/attention#blockers");
  await expect(dashboardBlockersTile).toContainText(/[1-9]\d*/);

  await dashboardBlockersTile.click();
  await page.waitForURL(/\/attention#blockers/);

  // Attention Center: the same StatTile component renders its own "Blockers" tile.
  const attentionBlockersTile = page.getByRole("link", { name: /Blockers/ });
  await expect(attentionBlockersTile).toBeVisible();
  await expect(attentionBlockersTile).toContainText(/[1-9]\d*/);
  await expect(page.getByText(blockerReason)).toBeVisible();

  expect(consoleErrors).toHaveLength(0);
});

test("budget usage meter reflects the client's effective budget state", async ({ page }) => {
  await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);

  const clientHeading = page.getByRole("heading", { name: "Client B (isolation fixture)" });
  const clientSection = page.locator("section", { has: clientHeading });
  await expect(clientSection).toBeVisible();

  // Order-independent sanity check: whatever the section's effective-budget text currently
  // says, the meter's presence must agree with it (no meter implies "No limit", a meter implies
  // a $ value) — true regardless of what earlier tests (e.g. slice6's org-budget test) already
  // set, since this only checks the *relationship*, not an absolute starting state.
  const effectiveBudgetText = await clientSection.getByText(/Effective budget:/).innerText();
  const meterBefore = clientSection.getByText(/% of budget used/);
  if (effectiveBudgetText.includes("No limit")) {
    await expect(meterBefore).toHaveCount(0);
  } else {
    await expect(meterBefore).toBeVisible();
  }

  // Deterministic positive case: set a fresh override on Client B and confirm the meter appears
  // showing 0% (no AI cost recorded against this client).
  const suffix = Date.now().toString(36);
  const budgetValue = (100 + (Number(suffix.replace(/\D/g, "")) % 900)).toString();
  await clientSection.getByLabel("AI budget ($)").fill(budgetValue);
  await clientSection.getByRole("button", { name: "Preview" }).click();
  await clientSection.getByRole("button", { name: "Confirm" }).click();
  await expect(clientSection.getByText(new RegExp(`Effective budget:\\s*\\$${budgetValue}\\b`))).toBeVisible({ timeout: 10_000 });

  const meterAfter = clientSection.getByText(/0% of budget used/);
  await expect(meterAfter).toBeVisible();
});

test("client section avatar stack reflects client team membership", async ({ page }) => {
  await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);

  // Default Client has exactly one member (the seeded viewer@example.com, VIEWER role) —
  // its section shows a one-avatar stack with that member's initials.
  const defaultClientSection = page.locator("section", { has: page.getByRole("heading", { name: "Default Client" }) });
  await expect(defaultClientSection.getByTitle("Viewer User")).toBeVisible();

  // Client B (isolation fixture) has no members at all — its section shows no avatar stack.
  const clientBSection = page.locator("section", { has: page.getByRole("heading", { name: "Client B (isolation fixture)" }) });
  await expect(clientBSection.getByTitle(/./)).toHaveCount(0);
});

test("command palette: open, search, select a result, and enforce tenancy isolation", async ({ page }) => {
  const suffix = Date.now().toString(36);
  const projectKey = `S9CP${suffix}`.toUpperCase().slice(0, 10);
  const projectName = `Slice9 Palette ${suffix}`;
  const workItemTitle = `Palette item ${suffix}`;

  // --- Admin: create a project + work item on Client B, then find it via the command palette. ---
  await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);

  await page.getByLabel("Client").selectOption({ label: "Client B (isolation fixture)" });
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

  const palette = await openCommandPalette(page);
  await palette.getByPlaceholder("Search work items and projects…").fill(workItemTitle);
  await expect(palette.getByText(workItemTitle)).toBeVisible();
  await palette.getByText(workItemTitle).click();
  await page.waitForURL(/\/work-items\/.+\/360/);
  await expect(page.getByRole("heading", { name: workItemTitle })).toBeVisible();

  // --- Viewer: only a member of Default Client, not Client B — the same search must find nothing. ---
  await page.getByRole("link", { name: "Dashboard", exact: true }).click();
  await page.waitForURL("/");
  await page.getByRole("button", { name: /sign out/i }).click();
  await page.waitForURL(/\/login/);

  await login(page, VIEWER_EMAIL, VIEWER_PASSWORD);
  const viewerPalette = await openCommandPalette(page);
  await viewerPalette.getByPlaceholder("Search work items and projects…").fill(workItemTitle);
  await expect(viewerPalette.getByText("No results")).toBeVisible();
  await expect(viewerPalette.getByText(workItemTitle)).toHaveCount(0);
});
