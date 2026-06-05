import { test } from "node:test";
import assert from "node:assert/strict";

// Scaffold placeholder. Real TDD suites land with the thin-vertical-slice build
// (design spec §12.4, §13). This proves the test runner is wired.
test("scaffold: test runner is wired", () => {
  assert.equal(1 + 1, 2);
});
