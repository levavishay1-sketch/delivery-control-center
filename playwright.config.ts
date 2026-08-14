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
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    // Always spawn a fresh server for this run, forcing the mock AI executor
    // (no ANTHROPIC_API_KEY) so the smoke test doesn't depend on a live model
    // provider or its billing state.
    reuseExistingServer: false,
    timeout: 60_000,
    env: { ...process.env, ANTHROPIC_API_KEY: "" },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
