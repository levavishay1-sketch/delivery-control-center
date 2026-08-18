import { test, expect } from "@playwright/test";

const ADMIN_EMAIL = "admin@example.com";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || "change-me-now";

/**
 * Slice 16 (project-wide-planner): create a project with two work items and a dependency
 * between them, open the project's Planner, verify the Graph view renders both items, switch
 * to the Board view, and verify status-lane grouping plus that the unblocked item is marked
 * "ready to start" while the item waiting on it is not.
 */
test("project-wide planner: graph and board views, ready-to-start distinguishes blocked from unblocked", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(err.message));

  const suffix = Date.now().toString(36);
  const projectName = `Planner E2E ${suffix}`;
  const projectKey = `PLN${suffix}`.toUpperCase().slice(0, 10);
  const foundationTitle = `Foundation ${suffix}`;
  const dependentTitle = `Dependent Feature ${suffix}`;

  await page.goto("/login");
  await page.fill('input[name="email"]', ADMIN_EMAIL);
  await page.fill('input[name="password"]', ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("/");

  // --- Create the project and two work items ---
  await page.getByLabel("Project name").fill(projectName);
  await page.getByLabel("Key").fill(projectKey);
  await page.getByRole("button", { name: "Add project" }).click();
  const projectHeading = page.getByRole("heading", { name: projectName });
  await expect(projectHeading).toBeVisible();
  const projectCard = page.locator("div.rounded-lg", { has: projectHeading });

  for (const title of [foundationTitle, dependentTitle]) {
    await projectCard.getByText("+ Add work item").click();
    await projectCard.getByPlaceholder("Work item title").fill(title);
    await projectCard.getByRole("button", { name: "Create work item" }).click();
    await expect(projectCard.getByText(title)).toBeVisible();
  }

  // --- Add a dependency: Dependent Feature depends on Foundation (still OPEN, so unresolved) ---
  const dependentRow = projectCard.locator("div", { hasText: dependentTitle }).last();
  await dependentRow.getByRole("link", { name: "Quick View" }).click();
  const quickView = page.getByRole("dialog");
  await expect(quickView).toBeVisible();
  await quickView.getByRole("link", { name: "Open full 360° Record →" }).click();
  await page.waitForURL(/\/work-items\/.+\/360/);

  await page.getByRole("tab", { name: "Dependencies" }).click();
  await page.getByRole("button", { name: "+ Add Dependency" }).click();
  await page.locator("select").filter({ hasText: foundationTitle }).selectOption({ label: foundationTitle });
  await page.getByPlaceholder("Reason for the dependency").fill("Dependent Feature builds on Foundation");
  await page.getByRole("button", { name: "Add Dependency", exact: true }).click();
  const dependsOnSection = page.locator("section", { has: page.getByRole("heading", { name: "Depends on" }) });
  await expect(dependsOnSection.getByText(foundationTitle)).toBeVisible();

  // --- Open the project's Planner ---
  await page.goto("/");
  await expect(projectHeading).toBeVisible();
  await projectCard.getByRole("link", { name: "Planner" }).click();
  await page.waitForURL(/\/projects\/.+\/planner/);

  // --- Graph view (default): both items render as graph nodes ---
  const graphSvg = page.getByRole("img", { name: /Dependency graph/ });
  await expect(graphSvg).toBeVisible();
  await expect(graphSvg.locator("text", { hasText: foundationTitle.slice(0, 19) })).toBeVisible();
  await expect(graphSvg.locator("text", { hasText: dependentTitle.slice(0, 19) })).toBeVisible();
  await expect(page.getByText("Ready to start", { exact: true })).toBeVisible(); // graph legend entry

  // --- Switch to Board view: status-lane grouping, readyToStart distinguishes the two ---
  await page.getByRole("button", { name: "Board" }).click();
  await expect(page.getByText(/OPEN \(2\)/)).toBeVisible();

  const foundationCard = page.locator("a", { hasText: foundationTitle });
  const dependentCard = page.locator("a", { hasText: dependentTitle });
  await expect(foundationCard.getByText("● Ready")).toBeVisible();
  await expect(dependentCard.getByText("● Ready")).toHaveCount(0);

  // --- Clicking through a card opens the item's 360° Record ---
  await foundationCard.click();
  await page.waitForURL(/\/work-items\/.+\/360/);
  await expect(page.getByRole("heading", { name: foundationTitle })).toBeVisible();

  expect(consoleErrors, `Console errors: ${consoleErrors.join("\n")}`).toEqual([]);
});
