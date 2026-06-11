import { test } from "node:test";
import assert from "node:assert/strict";

import { shouldSweepAbandonedWorktree } from "../plugins/jam/scripts/lib/worktree-sweep.mjs";

test("abandoned worktree sweep never removes a known live pid even after turn completion", () => {
  const w = { pid: 12345, eventLog: "/tmp/events.jsonl" };
  const eligible = shouldSweepAbandonedWorktree(w, {
    pidAlive: () => true,
    hasTurnCompleted: () => true,
  });

  assert.equal(eligible, false);
});

test("abandoned worktree sweep removes only completed dead-pid or unknown-pid entries", () => {
  assert.equal(shouldSweepAbandonedWorktree(
    { pid: 12345, eventLog: "/tmp/events.jsonl" },
    { pidAlive: () => false, hasTurnCompleted: () => true }
  ), true);
  assert.equal(shouldSweepAbandonedWorktree(
    { eventLog: "/tmp/events.jsonl" },
    { pidAlive: () => false, hasTurnCompleted: () => false }
  ), true);
  assert.equal(shouldSweepAbandonedWorktree(
    { pid: 12345, eventLog: "/tmp/events.jsonl" },
    { pidAlive: () => false, hasTurnCompleted: () => false }
  ), false);
});
