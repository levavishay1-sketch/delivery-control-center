// Smoke test written by DCC onboarding: proves a test can run here, with
// nothing to install (Node's built-in runner). Run: node --test tests/
// Extend it, or move it into the repository's own runner once there is one,
// rather than starting a second one.
import { test } from "node:test";
import assert from "node:assert/strict";

test("the test runner works", () => {
  assert.equal(1 + 1, 2);
});
