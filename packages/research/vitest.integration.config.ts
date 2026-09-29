import { defineConfig } from "vitest/config";

// The research package's integration tests: they build git repositories and
// spawn a mock agent. One file at a time, with room for process start-up on
// Windows. `npm run -w @dcc/research test:integration`.
export default defineConfig({
  test: {
    include: ["src/**/*.integration.test.ts"],
    environment: "node",
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
