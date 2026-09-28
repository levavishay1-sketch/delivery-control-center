import { defineConfig } from "vitest/config";

// Unit tests for the web client sit next to the code as `*.test.ts(x)`.
// The server's tests are C# (xUnit) under Server/tests — `npm test` runs both.
export default defineConfig({
  test: {
    include: ["Client/src/**/*.test.{ts,tsx}"],
    environment: "node",
  },
});
