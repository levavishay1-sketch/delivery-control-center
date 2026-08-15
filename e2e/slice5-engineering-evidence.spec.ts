import { test, expect } from "@playwright/test";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

const ADMIN_EMAIL = "admin@example.com";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || "change-me-now";

/**
 * A tiny local HTTP stub standing in for GitHub's REST API — same rationale as Slice 4's
 * startStubJiraServer (e2e/slice4-connector-framework.spec.ts): deterministic control, no real
 * network egress in this sandbox. Shaped exactly like the endpoints github.ts's fetchRepository/
 * fetchCommits/fetchPullRequests/fetchCheckRuns call, reachable via the connector config's
 * baseUrl override (src/lib/integrations/github.ts).
 */
function startStubGithubServer(): {
  server: Server;
  port: number;
  setLatestCheckStatus: (status: "success" | "failure") => void;
} {
  let latestCheckConclusion: "success" | "failure" = "success";
  const server = createServer((req, res) => {
    const url = req.url ?? "";
    res.setHeader("content-type", "application/json");

    if (/^\/repos\/[^/]+\/[^/]+$/.test(url)) {
      res.end(JSON.stringify({ id: 1, name: "widgets", owner: { login: "acme" } }));
      return;
    }
    if (url.startsWith("/repos/") && url.includes("/commits/") && url.includes("/check-runs")) {
      res.end(
        JSON.stringify({
          check_runs: [
            {
              id: 500,
              name: "test",
              status: "completed",
              conclusion: latestCheckConclusion,
              head_sha: "e2eheadsha",
              started_at: "2026-08-01T00:00:00Z",
              completed_at: "2026-08-01T00:05:00Z",
            },
          ],
        })
      );
      return;
    }
    if (url.startsWith("/repos/") && url.includes("/commits")) {
      res.end(
        JSON.stringify([
          {
            sha: "e2eheadsha",
            html_url: "https://github.com/acme/widgets/commit/e2eheadsha",
            commit: { message: "Ship the feature", author: { name: "Ada", date: "2026-08-01T00:00:00Z" } },
          },
        ])
      );
      return;
    }
    if (url.startsWith("/repos/") && url.includes("/pulls")) {
      res.end(
        JSON.stringify([
          {
            number: 42,
            title: "Ship the feature",
            state: "closed",
            merged_at: "2026-08-01T01:00:00Z",
            html_url: "https://github.com/acme/widgets/pull/42",
            head: { sha: "e2eheadsha" },
          },
        ])
      );
      return;
    }
    res.writeHead(404);
    res.end();
  });
  server.listen(0);
  const port = (server.address() as AddressInfo).port;
  return { server, port, setLatestCheckStatus: (status) => { latestCheckConclusion = status; } };
}

/**
 * Slice 5 engineering evidence end-to-end (Task Group 9): configure a GitHub connector against a
 * local stub → link its repository (catch-up fetch records a merged PR with a passing check run)
 * → create a work item, move it to APPROVED → link the pull request as evidence on the Code &
 * Changes tab → the Evidence tab shows the completion policy satisfied → completing the work item
 * succeeds. Separately: a second work item with no linked evidence is refused completion with a
 * descriptive error, then a write-capable role approves a completion exception and completion
 * then succeeds. No console errors.
 */
test("engineering evidence: link repository → link PR → complete; no-evidence refusal → exception → complete", async ({ page }) => {
  test.setTimeout(180_000);

  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(err.message));

  const stub = startStubGithubServer();

  try {
    const suffix = Date.now().toString(36);
    const projectName = `Evidence E2E ${suffix}`;
    const projectKey = `EE${suffix}`.toUpperCase().slice(0, 10);

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

    // --- Configure the GitHub connector against the stub (no UI field for baseUrl — a
    // GitHub-Enterprise-style override isn't part of this slice's UI scope — so this uses the
    // same authenticated session via page.request, a real call through the app's own API route). ---
    const configureResp = await page.request.post(`/api/projects/${projectId}/connector`, {
      data: { type: "GITHUB", config: { owner: "acme", repo: "widgets", token: "e2e-token", baseUrl: `http://localhost:${stub.port}` } },
    });
    expect(configureResp.ok()).toBe(true);

    // --- Link the repository from Settings ---
    await page.goto(`/projects/${projectId}/settings`);
    await page.getByRole("button", { name: "Link repository" }).click();
    await expect(page.getByText("Linked: acme/widgets")).toBeVisible({ timeout: 15_000 });

    // --- Create a work item ---
    const workItemTitle = `Ship the feature ${suffix}`;
    await page.goto("/");
    const card = page.locator("div.rounded-lg", { has: page.getByRole("heading", { name: projectName }) });
    await card.getByText("+ Add work item").click();
    await card.getByPlaceholder("Work item title").fill(workItemTitle);
    await card.getByPlaceholder("Description").fill("Exercised by the Slice 5 E2E test");
    await card.getByRole("button", { name: "Create work item" }).click();
    await expect(card.getByText(workItemTitle)).toBeVisible();

    const workItemRow = card.locator("div", { hasText: workItemTitle }).last();
    await workItemRow.getByText("Quick View").click();
    await page.getByText("Open full 360° Record →").click();
    await page.waitForURL(/\/work-items\/.+\/360/);
    const workItemUrl = page.url();
    const workItemId = workItemUrl.match(/\/work-items\/([^/]+)\/360/)?.[1];
    if (!workItemId) throw new Error(`Could not extract work item id from ${workItemUrl}`);

    // --- Move to APPROVED (no dedicated UI control for manual status transitions yet — this
    // exercises the same authenticated app API a future control would call). ---
    for (const status of ["IN_PROGRESS", "REVIEW", "APPROVED"]) {
      const resp = await page.request.patch(`/api/work-items/${workItemId}/status`, { data: { status } });
      expect(resp.ok(), `moving to ${status}`).toBe(true);
    }

    // --- Attempting COMPLETED with no linked evidence is refused ---
    const refusedResp = await page.request.patch(`/api/work-items/${workItemId}/status`, { data: { status: "COMPLETED" } });
    expect(refusedResp.status()).toBe(400);
    const refusedBody = await refusedResp.json();
    expect(refusedBody.error).toMatch(/no pull request linked/i);

    // --- On the Code & Changes tab, link the (already catch-up-fetched) merged pull request ---
    await page.goto(`/work-items/${workItemId}/360`);
    await page.getByRole("tab", { name: "Code" }).click();
    await expect(page.getByText("No pull requests linked yet.")).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: "Link pull request" }).click();
    await expect(page.getByRole("tabpanel", { name: "Code" }).getByText("#42 Ship the feature")).toBeVisible({ timeout: 10_000 });

    // --- The Tests tab shows the recorded test run ---
    await page.getByRole("tab", { name: "Tests" }).click();
    await expect(page.getByText("PASSED")).toBeVisible({ timeout: 10_000 });

    // --- The Evidence tab now shows the completion policy satisfied ---
    await page.getByRole("tab", { name: "Evidence" }).click();
    await expect(page.getByText(/completion policy satisfied/i)).toBeVisible({ timeout: 10_000 });

    // --- Completing now succeeds ---
    const completeResp = await page.request.patch(`/api/work-items/${workItemId}/status`, { data: { status: "COMPLETED" } });
    expect(completeResp.ok()).toBe(true);

    // --- Second work item: no evidence at all, exercises the exception path ---
    const secondTitle = `No Evidence Item ${suffix}`;
    await page.goto("/");
    await card.getByText("+ Add work item").click();
    await card.getByPlaceholder("Work item title").fill(secondTitle);
    await card.getByPlaceholder("Description").fill("Exercises the completion-exception path");
    await card.getByRole("button", { name: "Create work item" }).click();
    await expect(card.getByText(secondTitle)).toBeVisible();

    const secondRow = card.locator("div", { hasText: secondTitle }).last();
    await secondRow.getByText("Quick View").click();
    await page.getByText("Open full 360° Record →").click();
    await page.waitForURL(/\/work-items\/.+\/360/);
    const secondWorkItemId = page.url().match(/\/work-items\/([^/]+)\/360/)?.[1];
    if (!secondWorkItemId) throw new Error("Could not extract second work item id");

    for (const status of ["IN_PROGRESS", "REVIEW", "APPROVED"]) {
      const resp = await page.request.patch(`/api/work-items/${secondWorkItemId}/status`, { data: { status } });
      expect(resp.ok(), `moving second item to ${status}`).toBe(true);
    }

    await page.goto(`/work-items/${secondWorkItemId}/360`);
    await page.getByRole("tab", { name: "Evidence" }).click();
    await expect(page.getByText(/completion policy not yet satisfied/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/no pull request linked/i)).toBeVisible();

    await page.getByLabel("Approve a completion exception").fill("Legacy hotfix — no CI available for this environment.");
    await page.getByRole("button", { name: "Approve exception" }).click();
    await expect(page.getByText(/completion exception approved/i)).toBeVisible({ timeout: 10_000 });

    const secondCompleteResp = await page.request.patch(`/api/work-items/${secondWorkItemId}/status`, { data: { status: "COMPLETED" } });
    expect(secondCompleteResp.ok()).toBe(true);

    expect(consoleErrors).toHaveLength(0);
  } finally {
    stub.server.close();
  }
});
