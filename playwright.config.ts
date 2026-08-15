import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: {
    baseURL: "http://localhost:3000",
  },
  // Two processes: the app itself, and the job worker that drafting is now offloaded to
  // (Task Group 5 — draftStage enqueues a job instead of calling the AI executor in-request,
  // so nothing ever leaves AI_DRAFTING without a worker running to pick the job up).
  webServer: [
    {
      command: "npm run dev",
      url: "http://localhost:3000",
      // Always spawn a fresh server for this run, forcing the mock AI executor
      // (no ANTHROPIC_API_KEY) so the smoke test doesn't depend on a live model
      // provider or its billing state.
      reuseExistingServer: false,
      timeout: 60_000,
      env: { ...process.env, ANTHROPIC_API_KEY: "" },
    },
    {
      command: "npm run worker",
      // No HTTP endpoint to poll for readiness; Playwright just starts it and moves on.
      // The worker's own 2s poll interval comfortably fits within test assertion timeouts.
      reuseExistingServer: false,
      timeout: 60_000,
      env: { ...process.env, ANTHROPIC_API_KEY: "" },
    },
  ],
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // The pinned @playwright/test version expects a headless-shell binary that
        // isn't installed in this environment; fall back to the pre-installed full
        // Chromium instead of triggering a download.
        launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
          ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
          : undefined,
      },
    },
  ],
});
