import { test, expect } from "@playwright/test";

const ADMIN_EMAIL = "admin@example.com";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || "change-me-now";

/**
 * Slice 19 (cascading-task-assignment): set an explicit executor on one WorkItem, leave another
 * unassigned, then change the Project's default executor twice — first "apply to unassigned
 * only" (only the unassigned item moves), then "reassign everyone" (the explicit item moves too).
 *
 * Opens the Quick View drawer only once per work item and captures its 360° Record URL for
 * direct re-navigation afterward — repeatedly opening/closing the drawer is a known trigger for
 * an unrelated pre-existing hydration-mismatch flake (see slice4-connector-framework.spec.ts,
 * documented in docs/ROADMAP.md's Slice 16 status block as reproducing at a pre-Slice-16 commit).
 */
test("cascading task assignment: default executor never silently overwrites an explicit one", async ({ page }) => {
  test.setTimeout(60_000);

  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(err.message));

  const suffix = Date.now().toString(36);
  const projectName = `Cascade E2E ${suffix}`;
  const projectKey = `CAE${suffix}`.toUpperCase().slice(0, 10);
  const unassignedTitle = `Unassigned Item ${suffix}`;
  const explicitTitle = `Explicit Item ${suffix}`;

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

  for (const title of [unassignedTitle, explicitTitle]) {
    await projectCard.getByText("+ Add work item").click();
    await projectCard.getByPlaceholder("Work item title").fill(title);
    await projectCard.getByRole("button", { name: "Create work item" }).click();
    await expect(projectCard.getByText(title)).toBeVisible();
  }

  // --- Open each item's 360° Record once via Quick View, capturing its URL for direct reuse ---
  await projectCard.locator("div", { hasText: unassignedTitle }).last().getByRole("link", { name: "Quick View" }).click();
  await page.getByRole("dialog").getByRole("link", { name: "Open full 360° Record →" }).click();
  await page.waitForURL(/\/work-items\/.+\/360/);
  const unassignedUrl = page.url();

  await page.goto("/");
  await expect(projectHeading).toBeVisible();
  await projectCard.locator("div", { hasText: explicitTitle }).last().getByRole("link", { name: "Quick View" }).click();
  await page.getByRole("dialog").getByRole("link", { name: "Open full 360° Record →" }).click();
  await page.waitForURL(/\/work-items\/.+\/360/);
  const explicitUrl = page.url();

  // --- Give the second item an explicit executor (HYBRID) ---
  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Executor type").selectOption("HYBRID");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("HYBRID", { exact: true })).toBeVisible();

  // --- Go to Project Settings, propose AI_AGENT as the default, apply to unassigned only ---
  await page.goto("/");
  await expect(projectHeading).toBeVisible();
  await projectCard.getByRole("link", { name: "Settings" }).click();
  await page.waitForURL(/\/projects\/.+\/settings/);

  await page.getByLabel("Default executor type").selectOption("AI_AGENT");
  await page.getByRole("button", { name: "Preview change" }).click();
  await expect(page.getByText(unassignedTitle)).toBeVisible();
  await expect(page.getByText(explicitTitle)).toBeVisible();
  await page.getByRole("button", { name: "Apply to unassigned only" }).click();
  // Wait for the cascade to actually finish (the form resets to its pre-preview state on
  // success) before navigating away — otherwise page.goto aborts the in-flight POST.
  await expect(page.getByRole("button", { name: "Preview change" })).toBeVisible();

  // --- The unassigned item moved to AI_AGENT; the explicit HYBRID item did not ---
  await page.goto(unassignedUrl);
  await expect(page.getByText("AI Agent")).toBeVisible();

  await page.goto(explicitUrl);
  await expect(page.getByText("HYBRID", { exact: true })).toBeVisible();

  // --- Change the default again to HUMAN (no specific member), reassign everyone this time ---
  await page.goto("/");
  await expect(projectHeading).toBeVisible();
  await projectCard.getByRole("link", { name: "Settings" }).click();
  await page.waitForURL(/\/projects\/.+\/settings/);

  await page.getByLabel("Default executor type").selectOption("HUMAN");
  await page.getByRole("button", { name: "Preview change" }).click();
  await page.getByRole("button", { name: "Reassign everyone" }).click();
  await expect(page.getByRole("button", { name: "Preview change" })).toBeVisible();

  // --- Both items now show HUMAN, including the previously-explicit one ---
  await page.goto(explicitUrl);
  await expect(page.getByText("HUMAN", { exact: true })).toBeVisible();

  expect(consoleErrors, `Console errors: ${consoleErrors.join("\n")}`).toEqual([]);
});
