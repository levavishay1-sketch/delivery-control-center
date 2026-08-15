import { test, expect, type Page } from "@playwright/test";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

const ADMIN_EMAIL = "admin@example.com";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || "change-me-now";

/**
 * A tiny local HTTP stub standing in for Jira's search API — gives the test full, deterministic
 * control over what a "sync" fetches without any real network egress (this sandbox has none) or
 * changing the real jira.ts adapter. Shaped exactly like the real endpoint jira.ts calls:
 * GET /rest/api/3/search -> { issues: [{ key, fields: { summary, description, status } }] }.
 */
function startStubJiraServer(): { server: Server; port: number; setIssue: (summary: string) => void } {
  let currentSummary = "Original title";
  const server = createServer((req, res) => {
    if (req.url?.startsWith("/rest/api/3/search")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          issues: [
            {
              key: "E2E-1",
              fields: {
                summary: currentSummary,
                description: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "stub description" }] }] },
                status: { name: "To Do" },
              },
            },
          ],
        })
      );
      return;
    }
    res.writeHead(404);
    res.end();
  });
  server.listen(0);
  const port = (server.address() as AddressInfo).port;
  return { server, port, setIssue: (summary: string) => { currentSummary = summary; } };
}

/**
 * Slice 4 connector framework end-to-end (Task Group 8.1): configure a project's connector
 * against a local deterministic stub → sync → verify a work item is created with provenance →
 * manually edit the synced field → sync again with a differing incoming value → verify the field
 * is unchanged and a conflict appears → resolve by keeping the manual value → verify unchanged
 * and the conflict clears → sync a third time with a new differing value → resolve by accepting
 * the incoming value → verify the field updates and its provenance now shows sync as the source →
 * verify sync history reflects every SyncRun. No console errors.
 */
test("connector framework: sync → provenance → conflict → keep-manual → conflict-again → accept-incoming", async ({ page }) => {
  test.setTimeout(180_000);

  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(err.message));

  const stub = startStubJiraServer();

  try {
    const suffix = Date.now().toString(36);
    const projectName = `Connector E2E ${suffix}`;
    const projectKey = `CE${suffix}`.toUpperCase().slice(0, 10);

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
    const projectSettingsPath = `/projects/${projectId}/settings`;

    // --- Navigate to Settings and configure the connector against the stub ---
    await projectCard.getByRole("link", { name: "Settings" }).click();
    await page.waitForURL(/\/projects\/.+\/settings/);

    await page.locator("select").selectOption("JIRA");
    await page.getByLabel("Base URL").fill(`http://localhost:${stub.port}`);
    await page.getByLabel("Email").fill("e2e@example.com");
    await page.getByLabel("API token").fill("stub-token");
    await page.getByLabel("Project key").fill("E2E");
    await page.getByRole("button", { name: "Save connector" }).click();
    await expect(page.getByText("Saved")).toBeVisible({ timeout: 10_000 });

    // --- Trigger the first sync: creates the work item with title "Original title" ---
    await triggerSyncAndWaitForCompletion(page, 1);

    const bodyAfterFirstSync = await page.locator("body").innerText();
    expect(bodyAfterFirstSync).toMatch(/1 created/);

    // --- Navigate to the new work item's 360 page. It has no pipeline (sync only creates work
    // items, per this codebase's actual startPipeline-is-explicit behavior), so the dashboard row
    // has no direct link — go through Quick View's "Open full 360° Record" link instead. ---
    await page.goto("/");
    await page.waitForTimeout(500);
    const workItemRow = page.locator("div", { hasText: "Original title" }).last();
    await workItemRow.getByText("Quick View").click();
    await page.getByText("Open full 360° Record →").click();
    await page.waitForURL(/\/work-items\/.+\/360/);

    await expect(page.getByRole("heading", { name: "Original title" })).toBeVisible();
    // Provenance affordance present for a synced field (SYNC source).
    await expect(page.locator('[aria-label^="Synced"]').first()).toBeVisible({ timeout: 10_000 });

    const workItemUrl = page.url();
    const workItemId = workItemUrl.match(/\/work-items\/([^/]+)\/360/)?.[1];
    if (!workItemId) throw new Error(`Could not extract work item id from ${workItemUrl}`);

    // --- Manually edit the title ---
    await page.getByRole("button", { name: "Edit" }).click();
    const titleInput = page.locator('label:has-text("Title") + input, label:has-text("Title") input').first();
    await titleInput.fill("Manually edited title");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("heading", { name: "Manually edited title" })).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[aria-label^="Manually set"]').first()).toBeVisible({ timeout: 10_000 });

    // --- Sync again with a differing incoming title: should conflict, not overwrite ---
    stub.setIssue("Incoming synced title");
    await page.goto(projectSettingsPath);
    await triggerSyncAndWaitForCompletion(page, 2);

    const conflictBody = await page.locator("body").innerText();
    expect(conflictBody).toMatch(/1 conflicted/);
    expect(conflictBody).toMatch(/open sync conflicts/i);
    expect(conflictBody).toContain("Manually edited title");
    expect(conflictBody).toContain("Incoming synced title");

    // The work item's title must still be the manual value.
    await page.goto(`/work-items/${workItemId}/360`);
    await expect(page.getByRole("heading", { name: "Manually edited title" })).toBeVisible();

    // --- Resolve by keeping the manual value ---
    await page.goto(projectSettingsPath);
    await expect(page.getByText("Open Sync Conflicts")).toBeVisible();
    await page.getByRole("button", { name: "Keep manual" }).click();
    await expect(page.getByText("Open Sync Conflicts")).not.toBeVisible({ timeout: 10_000 });

    await page.goto(`/work-items/${workItemId}/360`);
    await expect(page.getByRole("heading", { name: "Manually edited title" })).toBeVisible();

    // --- Sync a third time with a new differing value: conflict reappears ---
    stub.setIssue("Second incoming title");
    await page.goto(projectSettingsPath);
    await triggerSyncAndWaitForCompletion(page, 3);
    await expect(page.getByText("Open Sync Conflicts")).toBeVisible({ timeout: 10_000 });
    const secondConflictBody = await page.locator("body").innerText();
    expect(secondConflictBody).toContain("Second incoming title");

    // --- Resolve by accepting the incoming value ---
    await page.getByRole("button", { name: "Accept incoming" }).click();
    await expect(page.getByText("Open Sync Conflicts")).not.toBeVisible({ timeout: 10_000 });

    await page.goto(`/work-items/${workItemId}/360`);
    await expect(page.getByRole("heading", { name: "Second incoming title" })).toBeVisible({ timeout: 10_000 });
    // Provenance now shows sync as the source again.
    await expect(page.locator('[aria-label^="Synced"]').first()).toBeVisible();

    // --- Sync history reflects every SyncRun ---
    await page.goto(projectSettingsPath);
    const finalBody = await page.locator("body").innerText();
    expect((finalBody.match(/SUCCEEDED/g) ?? []).length).toBeGreaterThanOrEqual(3);

    expect(consoleErrors).toHaveLength(0);
  } finally {
    stub.server.close();
  }
});

async function triggerSyncAndWaitForCompletion(page: Page, expectedRunCount: number) {
  const [syncResp] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("/sync") && r.request().method() === "POST"),
    page.getByRole("button", { name: "Sync" }).click(),
  ]);
  expect(syncResp.status()).toBe(202);

  await expect
    .poll(
      async () => {
        await page.reload();
        const text = await page.locator("body").innerText();
        return (text.match(/SUCCEEDED|FAILED/g) ?? []).length;
      },
      { timeout: 30_000, intervals: [1000, 1000, 2000, 2000] }
    )
    .toBeGreaterThanOrEqual(expectedRunCount);
}
