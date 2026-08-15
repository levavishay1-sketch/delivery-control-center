import { test, expect } from "@playwright/test";

const ADMIN_EMAIL = "admin@example.com";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || "change-me-now";

/**
 * Slice 8 end-to-end scenario: switch to Hebrew from the nav rail -> verify
 * <html dir="rtl"> and Hebrew text on the Dashboard and Attention Center ->
 * verify the Quick View drawer opens from the mirrored (left) edge -> verify
 * 360° Record tab arrow-key navigation reverses under RTL -> verify a
 * subsequent page load renders RTL from the server response itself (no
 * LTR-then-RTL flash), then switch back to English and verify layout/text
 * revert.
 */
test("i18n/RTL: switch to Hebrew, verify layout mirroring, tab-nav reversal, and no direction flash on reload", async ({ page }) => {
  const suffix = Date.now().toString(36);
  const projectKey = `S8E2E${suffix}`.toUpperCase().slice(0, 10);
  const projectName = `Slice8 E2E ${suffix}`;
  const workItemTitle = `RTL work item ${suffix}`;

  // 1. Log in.
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
  await page.fill('input[name="email"]', ADMIN_EMAIL);
  await page.fill('input[name="password"]', ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("/");

  // Default locale is English, LTR.
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");

  // 2. Create a project + work item to exercise Quick View against, before switching locale
  // (form labels/placeholders are English-only chrome outside this slice's translation scope).
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

  // 3. Switch to Hebrew from the nav rail's language switcher.
  await page.getByRole("button", { name: "עברית" }).click();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl", { timeout: 10_000 });
  await expect(page.locator("html")).toHaveAttribute("lang", "he");

  // 4. Dashboard renders Hebrew text (attention summary heading + a known chrome string).
  await expect(page.getByRole("heading", { name: "לוח בקרה" })).toBeVisible();
  await expect(page.getByText("סיכום התראות")).toBeVisible();

  // 5. Attention Center renders Hebrew text too (nav rail label is itself Hebrew now).
  await page.getByRole("link", { name: "מרכז התראות" }).click();
  await page.waitForURL(/\/attention/);
  await expect(page.getByRole("heading", { name: "מרכז התראות" })).toBeVisible();

  // 6. Quick View drawer opens from the mirrored (left) edge under RTL.
  await page.getByRole("link", { name: "לוח בקרה" }).click();
  await page.waitForURL("/");
  const workItemRow = page.locator("div", { hasText: workItemTitle }).last();
  await workItemRow.getByRole("link", { name: "Quick View" }).click();
  const drawer = page.getByRole("dialog");
  await expect(drawer).toBeVisible();
  const box = await drawer.boundingBox();
  expect(box).not.toBeNull();
  // Mirrored from its LTR right-edge position: under RTL it should sit flush against the left edge.
  expect(box!.x).toBeLessThan(10);
  await page.keyboard.press("Escape");
  await expect(drawer).not.toBeVisible();

  // 7. 360° Record tab arrow-key navigation reverses under RTL: ArrowLeft advances
  // (Overview -> Dependencies), matching the visual "next" direction under RTL reading order.
  await workItemRow.getByRole("link", { name: "Quick View" }).click();
  await expect(drawer).toBeVisible();
  await drawer.getByRole("link", { name: /פתח רשומת 360° מלאה/ }).click();
  await page.waitForURL(/\/work-items\/.+\/360/);
  const overviewTab = page.getByRole("tab", { name: "סקירה כללית" });
  await expect(overviewTab).toBeVisible();
  await overviewTab.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("tab", { name: "תלויות", selected: true })).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "סקירה כללית", selected: true })).toBeVisible();

  // 8. No LTR-then-RTL flash: the server's own HTML response already carries dir="rtl",
  // not just a post-hydration client-side correction.
  const response = await page.goto("/");
  const html = (await response?.text()) ?? "";
  expect(html).toMatch(/<html[^>]*\bdir="rtl"/);
  expect(html).toMatch(/<html[^>]*\blang="he"/);

  // 9. Switch back to English and verify layout/text revert.
  await page.getByRole("button", { name: "English" }).click();
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr", { timeout: 10_000 });
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
});
