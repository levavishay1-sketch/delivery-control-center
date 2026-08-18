import { test, expect } from "@playwright/test";

const ADMIN_EMAIL = "admin@example.com";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || "change-me-now";

/**
 * Slice 11 shared InfoTooltip primitive end-to-end (Task 3.3): proves the design-system
 * requirement's "reachable without a mouse" scenario against a real page, not just a unit
 * test — a keyboard-only user must be able to reveal the same explanation a mouse-hover user
 * sees. Uses the same AI Budget adoption site as the RTL check in slice8-i18n-rtl.spec.ts.
 */
test("InfoTooltip: reveal and dismiss the AI Budget explanation using only the keyboard", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(err.message));

  await page.goto("/login");
  await page.fill('input[name="email"]', ADMIN_EMAIL);
  await page.fill('input[name="password"]', ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("/");

  const infoTrigger = page.getByRole("button", { name: "What is the effective budget?" }).first();
  const explanation = page.getByText(/effective budget is the AI spending limit/i);

  // Not visible until activated — no hover event fired by keyboard-only navigation.
  await expect(explanation).not.toBeVisible();

  // Reach it purely by keyboard: focus the trigger, activate with Enter (no mouse anywhere).
  await infoTrigger.focus();
  await expect(infoTrigger).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(explanation).toBeVisible();
  await expect(infoTrigger).toHaveAttribute("aria-expanded", "true");

  // Escape dismisses it and returns state cleanly (aria-expanded reflects closed).
  await page.keyboard.press("Escape");
  await expect(explanation).not.toBeVisible();
  await expect(infoTrigger).toHaveAttribute("aria-expanded", "false");

  // Space also activates it (native button semantics), proving it isn't Enter-only.
  await infoTrigger.focus();
  await page.keyboard.press(" ");
  await expect(explanation).toBeVisible();

  expect(consoleErrors).toHaveLength(0);
});
