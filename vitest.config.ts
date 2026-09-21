import { defineConfig } from "vitest/config";

// Unit tests sit next to the code as `*.test.ts`. They must stay pure: a test
// that imports `@dcc/db` (directly or through `@dcc/core`'s index) opens the
// embedded PGlite directory, which is unsafe while the API holds it. Import the
// module under test by its own file, as `ado-url.test.ts` does.
export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts", "apps/*/src/**/*.test.ts"],
    environment: "node",
  },
});
