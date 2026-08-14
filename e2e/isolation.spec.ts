import { test, expect } from "@playwright/test";

const VIEWER_EMAIL = "viewer@example.com";
const VIEWER_PASSWORD = process.env.SEED_ADMIN_PASSWORD || "change-me-now";

/**
 * Proves the Slice 0 "done-when" tenancy/authorization properties end-to-end, using the
 * fixtures the seed script creates: a "Client B" the seeded viewer has no membership on, and
 * a VIEWER-role membership on the default client.
 */
test.describe("tenancy and role isolation", () => {
  test("an unauthenticated request redirects to login", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/login/);
  });

  test("a client-scoped user cannot see another client's data", async ({ page }) => {
    await page.goto("/login");
    await page.fill('input[name="email"]', VIEWER_EMAIL);
    await page.fill('input[name="password"]', VIEWER_PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("/");

    await expect(page.getByRole("heading", { name: "Default Client" })).toBeVisible();
    await expect(page.getByText("Client B (isolation fixture)")).not.toBeVisible();
  });

  test("a VIEWER cannot approve a stage, even on a client they belong to", async ({ page }) => {
    await page.goto("/login");
    await page.fill('input[name="email"]', VIEWER_EMAIL);
    await page.fill('input[name="password"]', VIEWER_PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("/");

    // The seeded demo work item's pipeline is on the viewer's own (only) client — navigate to
    // it via the UI, then read a stage's id off the page (data-stage-id) to attempt an approve
    // call directly. Authorization is checked before stage-state, so this is a valid probe
    // regardless of which stage or state it's in.
    await page.getByRole("link", { name: "Add password-reset self-service flow" }).first().click();
    await page.waitForURL(/\/pipelines\//);

    const stageId = await page.locator("[data-stage-id]").first().getAttribute("data-stage-id");
    expect(stageId).toBeTruthy();

    const res = await page.request.post(`/api/stages/${stageId}/approve`, { data: {} });
    expect(res.status()).toBe(403);
  });
});
