import { test, expect } from "@playwright/test";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

const ADMIN_EMAIL = "admin@example.com";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || "change-me-now";

/**
 * Server-rendered pages here don't auto-poll — router.refresh() right after triggering a run
 * shows it still RUNNING (the worker hasn't picked it up yet, on its own 2s poll interval).
 * Reloads until the awaited text appears or the timeout elapses.
 */
async function waitForTextByReloading(page: import("@playwright/test").Page, pattern: RegExp, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await page.getByText(pattern).first().isVisible().catch(() => false)) return;
    await page.waitForTimeout(1000);
    await page.reload();
  }
  await expect(page.getByText(pattern).first()).toBeVisible();
}

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.fill('input[name="email"]', ADMIN_EMAIL);
  await page.fill('input[name="password"]', ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("/");
}

function base64(text: string): string {
  return Buffer.from(text, "utf-8").toString("base64");
}

/** Same stub-server shape as slice12-client-lifecycle.spec.ts, extended with the Contents API endpoints Discovery fetches. */
function startStubGithubServer(): { server: Server; port: number } {
  const server = createServer((req, res) => {
    const url = req.url ?? "";
    res.setHeader("content-type", "application/json");

    if (/\/contents\/README\.md$/.test(url)) {
      res.end(JSON.stringify({ content: base64("# Widgets\nA widget factory."), encoding: "base64" }));
      return;
    }
    if (/\/contents\/package\.json$/.test(url)) {
      res.end(JSON.stringify({ content: base64('{"name":"widgets"}'), encoding: "base64" }));
      return;
    }
    if (/\/contents\/$/.test(url)) {
      res.end(
        JSON.stringify([
          { name: "README.md", type: "file" },
          { name: "package.json", type: "file" },
          { name: "src", type: "dir" },
        ])
      );
      return;
    }
    if (/^\/repos\/[^/]+\/[^/]+$/.test(url)) {
      res.end(JSON.stringify({ id: 1, name: "widgets", owner: { login: "acme" } }));
      return;
    }
    if (url.includes("/check-runs")) {
      res.end(JSON.stringify({ check_runs: [] }));
      return;
    }
    if (url.includes("/commits")) {
      res.end(JSON.stringify([]));
      return;
    }
    if (url.includes("/pulls")) {
      res.end(JSON.stringify([]));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  server.listen(0);
  const port = (server.address() as AddressInfo).port;
  return { server, port };
}

/**
 * Slice 14: view a repository with no Discovery yet (empty state, button visible to a
 * write-capable user) → trigger a run → see it complete against the mock executor with
 * evidence-cited findings → trigger again → a second version appears without losing the first.
 */
test("repository Discovery: empty state → trigger → evidence-cited findings → second run creates v2", async ({ page }) => {
  test.setTimeout(120_000);

  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(err.message));

  const stub = startStubGithubServer();

  try {
    const suffix = Date.now().toString(36);
    const clientName = `Discovery Client ${suffix}`;
    const clientSlug = `discovery-client-${suffix}`;

    await login(page);

    // --- Create the client ---
    await page.goto("/clients");
    await page.getByLabel("Client name").fill(clientName);
    await page.getByLabel("Slug").fill(clientSlug);
    await page.getByRole("button", { name: "Add client" }).click();
    await expect(page.getByText(clientName)).toBeVisible();
    await page.getByText(clientName).click();
    await page.waitForURL(/\/clients\/.+/);
    const clientId = page.url().match(/\/clients\/([^/]+)/)?.[1];
    if (!clientId) throw new Error(`Could not extract client id from ${page.url()}`);

    // --- Create a project under this client and link a GitHub repository (stub-backed) ---
    await page.goto("/");
    const projectName = `Discovery Project ${suffix}`;
    const projectKey = `DIS${suffix}`.toUpperCase().slice(0, 10);
    await page.selectOption("#add-project-client", { label: clientName });
    await page.getByLabel("Project name").fill(projectName);
    await page.getByLabel("Key").fill(projectKey);
    await page.getByRole("button", { name: "Add project" }).click();
    const projectHeading = page.getByRole("heading", { name: projectName });
    await expect(projectHeading).toBeVisible();
    const projectCardId = await page.locator("div.rounded-lg", { has: projectHeading }).getAttribute("id");
    const projectId = projectCardId?.replace(/^project-/, "");
    if (!projectId) throw new Error(`Could not read project id from card element id: ${projectCardId}`);

    const connectorResp = await page.request.post(`/api/projects/${projectId}/connector`, {
      data: { type: "GITHUB", config: { owner: "acme", repo: "widgets", token: "e2e-token", baseUrl: `http://localhost:${stub.port}` } },
    });
    expect(connectorResp.ok()).toBe(true);

    await page.goto(`/projects/${projectId}/settings`);
    await page.getByRole("button", { name: "Link repository" }).click();
    await expect(page.getByText("Linked: acme/widgets")).toBeVisible({ timeout: 15_000 });

    // --- Navigate from the Clients hub's repository row to its Discovery page ---
    await page.goto(`/clients/${clientId}`);
    await page.getByText("acme/widgets").click();
    await page.waitForURL(/\/repositories\/.+/);

    // --- Empty state, with the trigger button visible to this write-capable (org-admin) user ---
    await expect(page.getByText("No Discovery run has completed for this repository yet.")).toBeVisible();
    const runButton = page.getByRole("button", { name: "Run Discovery" });
    await expect(runButton).toBeVisible();

    // --- Trigger a run and wait for it to complete against the mock executor ---
    await runButton.click();
    await waitForTextByReloading(page, /Discovery v1 — as of/);

    // --- Findings are evidence-cited from the real fetched snapshot, not fabricated ---
    await expect(page.getByText("Evidence: README.md")).toBeVisible();
    await expect(page.getByText("Evidence: package.json")).toBeVisible();
    await expect(page.getByText("SUCCEEDED").first()).toBeVisible();

    // --- Triggering again creates v2 without losing v1's history row ---
    await page.getByRole("button", { name: "Run Discovery again" }).click();
    await waitForTextByReloading(page, /Discovery v2 — as of/);
    await expect(page.getByText("v1", { exact: true })).toBeVisible();
    await expect(page.getByText("v2", { exact: true })).toBeVisible();

    expect(consoleErrors).toHaveLength(0);
  } finally {
    stub.server.close();
  }
});
