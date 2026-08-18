import { defineConfig } from "vitest/config";
import path from "node:path";
import "dotenv/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    exclude: ["**/node_modules/**", "e2e/**"],
    // src/lib/config.test.ts and src/domain/pipeline/commands.test.ts both temporarily
    // overwrite the real config/workflow.yaml on disk and restore it afterward — safe within a
    // single file (tests run sequentially there), but Vitest runs test *files* in parallel
    // worker processes by default, so two such files racing can have one read the other's
    // truncated mid-swap config, causing sporadic, hard-to-reproduce failures. Test files are
    // fast enough overall that running them sequentially is the simpler fix vs. mocking the
    // filesystem out of loadWorkflow().
    fileParallelism: false,
  },
});
