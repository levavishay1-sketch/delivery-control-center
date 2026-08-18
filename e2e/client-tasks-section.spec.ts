import { execFileSync } from "node:child_process";
import { test, expect } from "@playwright/test";

const ADMIN_EMAIL = "admin@example.com";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || "change-me-now";

function runFixture(clientId: string): {
  topLevelTaskTitle: string;
  topLevelBugTitle: string;
  topLevelProjectTitle: string;
  childItemTitle: string;
  closedItemTitle: string;
} {
  const output = execFileSync("npx", ["tsx", "e2e/fixtures/seedClientTasksFixtures.ts", "create", clientId], { encoding: "utf-8" });
  return JSON.parse(output);
}

/**
 * Slice 22 (client-tasks-section): on a client with a top-level Task, a top-level Bug, a
 * top-level PROJECT-type WorkItem, a child WorkItem under that PROJECT-type WorkItem, and a
 * CLOSED top-level WorkItem, verifies the Client detail page's Tasks section shows exactly the
 * three eligible top-level open items and excludes the child and the closed item.
 */
test("client Tasks section: shows top-level open work items, excludes children and closed items", async ({ page }) => {
  test.setTimeout(60_000);

  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(err.message));

  const suffix = Date.now().toString(36);
  const clientName = `Tasks Section E2E ${suffix}`;
  const clientSlug = `tasks-section-e2e-${suffix}`;

  await page.goto("/login");
  await page.fill('input[name="email"]', ADMIN_EMAIL);
  await page.fill('input[name="password"]', ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("/");

  // --- Create the client via the UI ---
  await page.goto("/clients");
  await page.getByLabel("Client name").fill(clientName);
  await page.getByLabel("Slug").fill(clientSlug);
  await page.getByRole("button", { name: "Add client" }).click();
  await expect(page.getByText(clientName)).toBeVisible();
  await page.getByText(clientName).click();
  await page.waitForURL(/\/clients\/.+/);
  const clientId = page.url().match(/\/clients\/([^/]+)/)?.[1];
  if (!clientId) throw new Error(`Could not extract client id from ${page.url()}`);

  // --- Seed the project + WorkItem hierarchy fixtures ---
  const fixtures = runFixture(clientId);

  // --- The Tasks section shows exactly the three eligible top-level open items ---
  await page.goto(`/clients/${clientId}`);
  const tasksPanel = page.locator("div.rounded-lg", { has: page.getByRole("heading", { name: "Tasks" }) });
  await expect(tasksPanel.getByText(fixtures.topLevelTaskTitle)).toBeVisible();
  await expect(tasksPanel.getByText(fixtures.topLevelBugTitle)).toBeVisible();
  await expect(tasksPanel.getByText(fixtures.topLevelProjectTitle)).toBeVisible();

  // --- The child item and the closed item are excluded ---
  await expect(tasksPanel.getByText(fixtures.childItemTitle)).toHaveCount(0);
  await expect(tasksPanel.getByText(fixtures.closedItemTitle)).toHaveCount(0);

  expect(consoleErrors, `Console errors: ${consoleErrors.join("\n")}`).toEqual([]);
});
