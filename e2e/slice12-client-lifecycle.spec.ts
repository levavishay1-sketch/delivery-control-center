import { test, expect } from "@playwright/test";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

const ADMIN_EMAIL = "admin@example.com";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || "change-me-now";

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.fill('input[name="email"]', ADMIN_EMAIL);
  await page.fill('input[name="password"]', ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("/");
}

/**
 * Slice 12 client lifecycle (Task 8.3): create a client from the Clients hub, edit its name/slug,
 * deactivate it — confirming it drops off the Dashboard but stays visible (marked inactive) in
 * the Clients hub and its own detail page — then reactivate it and confirm it reappears on the
 * Dashboard.
 */
test("client lifecycle: create → edit → deactivate (hidden from Dashboard, visible in hub) → reactivate (reappears)", async ({ page }) => {
  test.setTimeout(120_000);

  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(err.message));

  const suffix = Date.now().toString(36);
  const clientName = `Lifecycle Client ${suffix}`;
  const clientSlug = `lifecycle-client-${suffix}`;
  const renamedName = `${clientName} Renamed`;

  await login(page);

  // --- Create the client from the Clients hub ---
  await page.goto("/clients");
  await page.getByLabel("Client name").fill(clientName);
  await page.getByLabel("Slug").fill(clientSlug);
  await page.getByRole("button", { name: "Add client" }).click();
  await expect(page.getByText(clientName)).toBeVisible();

  await page.getByText(clientName).click();
  await page.waitForURL(/\/clients\/.+/);
  const clientId = page.url().match(/\/clients\/([^/]+)/)?.[1];
  if (!clientId) throw new Error(`Could not extract client id from ${page.url()}`);

  // --- Edit name/slug ---
  await page.getByLabel("Client name").fill(renamedName);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("heading", { name: renamedName })).toBeVisible();

  // --- Still active: shows on the Dashboard ---
  await page.goto("/");
  await expect(page.locator(`#client-${clientId}`)).toBeVisible();

  // --- Deactivate ---
  await page.goto(`/clients/${clientId}`);
  await page.getByRole("button", { name: "Deactivate" }).click();
  await expect(page.getByText("Inactive", { exact: true })).toBeVisible();

  // --- Dropped from the Dashboard ---
  await page.goto("/");
  await expect(page.locator(`#client-${clientId}`)).toHaveCount(0);

  // --- Still visible, marked inactive, in the Clients hub ---
  await page.goto("/clients");
  const inactiveRow = page.locator("a", { hasText: renamedName });
  await expect(inactiveRow.getByText("Inactive", { exact: true })).toBeVisible();

  // --- Reactivate ---
  await page.goto(`/clients/${clientId}`);
  await page.getByRole("button", { name: "Reactivate" }).click();
  await expect(page.getByText("Active", { exact: true }).first()).toBeVisible();

  // --- Reappears on the Dashboard ---
  await page.goto("/");
  await expect(page.locator(`#client-${clientId}`)).toBeVisible();

  expect(consoleErrors).toHaveLength(0);
});

function startStubGithubServer(): { server: Server; port: number } {
  const server = createServer((req, res) => {
    const url = req.url ?? "";
    res.setHeader("content-type", "application/json");

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
 * Slice 12 cross-project repository linking (Task 8.4): link the same GitHub repository to two
 * projects under the same client (via two separate GitHub connectors pointed at the same stub
 * repo, mirroring Slice 5's stub-server pattern) and confirm the Clients hub's detail view shows
 * one repository linked to both projects, not two.
 */
test("linking the same repository from a second project reuses it, not duplicates it", async ({ page }) => {
  test.setTimeout(120_000);

  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(err.message));

  const stub = startStubGithubServer();

  try {
    const suffix = Date.now().toString(36);
    const clientName = `Shared Repo Client ${suffix}`;
    const clientSlug = `shared-repo-client-${suffix}`;

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

    // --- Create two projects under this client from the Dashboard ---
    await page.goto("/");
    const projectAName = `Shared Repo Project A ${suffix}`;
    const projectAKey = `SRA${suffix}`.toUpperCase().slice(0, 10);
    await page.selectOption("#add-project-client", { label: clientName });
    await page.getByLabel("Project name").fill(projectAName);
    await page.getByLabel("Key").fill(projectAKey);
    await page.getByRole("button", { name: "Add project" }).click();
    const projectAHeading = page.getByRole("heading", { name: projectAName });
    await expect(projectAHeading).toBeVisible();
    const projectACardId = await page.locator("div.rounded-lg", { has: projectAHeading }).getAttribute("id");
    const projectAId = projectACardId?.replace(/^project-/, "");
    if (!projectAId) throw new Error(`Could not read project A id from card element id: ${projectACardId}`);

    const projectBName = `Shared Repo Project B ${suffix}`;
    const projectBKey = `SRB${suffix}`.toUpperCase().slice(0, 10);
    await page.selectOption("#add-project-client", { label: clientName });
    await page.getByLabel("Project name").fill(projectBName);
    await page.getByLabel("Key").fill(projectBKey);
    await page.getByRole("button", { name: "Add project" }).click();
    const projectBHeading = page.getByRole("heading", { name: projectBName });
    await expect(projectBHeading).toBeVisible();
    const projectBCardId = await page.locator("div.rounded-lg", { has: projectBHeading }).getAttribute("id");
    const projectBId = projectBCardId?.replace(/^project-/, "");
    if (!projectBId) throw new Error(`Could not read project B id from card element id: ${projectBCardId}`);

    // --- Configure a GitHub connector on each project, both pointed at the same stub repo ---
    for (const projectId of [projectAId, projectBId]) {
      const resp = await page.request.post(`/api/projects/${projectId}/connector`, {
        data: { type: "GITHUB", config: { owner: "acme", repo: "widgets", token: "e2e-token", baseUrl: `http://localhost:${stub.port}` } },
      });
      expect(resp.ok()).toBe(true);
    }

    // --- Link the repository from each project's Settings page ---
    for (const projectId of [projectAId, projectBId]) {
      await page.goto(`/projects/${projectId}/settings`);
      await page.getByRole("button", { name: "Link repository" }).click();
      await expect(page.getByText("Linked: acme/widgets")).toBeVisible({ timeout: 15_000 });
    }

    // --- The Clients hub detail view shows one repository, linked to both projects ---
    await page.goto(`/clients/${clientId}`);
    await expect(page.getByText("acme/widgets")).toHaveCount(1);
    const linkedToText = page.getByText(/Linked to:/);
    await expect(linkedToText).toContainText(projectAName);
    await expect(linkedToText).toContainText(projectBName);

    expect(consoleErrors).toHaveLength(0);
  } finally {
    stub.server.close();
  }
});
