import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRun } from "../plugins/jam/scripts/lib/actions.mjs";
import { readState } from "../plugins/jam/scripts/lib/state.mjs";
import { setGoal, getGoal } from "../plugins/jam/scripts/lib/goal.mjs";

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), "jam-goal-")); }

test("setGoal persists goal.md and records ref+source in state", () => {
  const root = tmp();
  const dir = createRun({ projectRoot: root, runId: "r1", mode: "repair", now: "t" });
  setGoal({ runDir: dir, text: "80% milestone: reviewer mean >= 4.1", source: "file:goal.md", now: "t1" });
  assert.ok(fs.existsSync(path.join(dir, "goal.md")));
  assert.equal(getGoal(dir), "80% milestone: reviewer mean >= 4.1");
  const s = readState(dir);
  assert.equal(s.goalRef, "goal.md");
  assert.equal(s.goalSource, "file:goal.md");
});

test("getGoal returns null when no goal set", () => {
  const root = tmp();
  const dir = createRun({ projectRoot: root, runId: "r1", mode: "repair", now: "t" });
  assert.equal(getGoal(dir), null);
});

test("setGoal rejects empty text", () => {
  const root = tmp();
  const dir = createRun({ projectRoot: root, runId: "r1", mode: "repair", now: "t" });
  assert.throws(() => setGoal({ runDir: dir, text: "  " }), /goal text required/);
});
