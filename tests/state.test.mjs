import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { runsRoot, runDir, activePointerPath, readActiveRunId } from "../plugins/jam/scripts/lib/paths.mjs";
import {
  createInitialState, validateState, readState, writeState, getGate, addGate
} from "../plugins/jam/scripts/lib/state.mjs";

function tmpProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "jam-"));
}

test("paths resolve under docs/superpowers/loop-runs", () => {
  const root = "/proj";
  assert.equal(runsRoot(root), path.join("/proj", "docs", "superpowers", "loop-runs"));
  assert.equal(runDir(root, "r1"), path.join(runsRoot(root), "r1"));
  assert.equal(activePointerPath(root), path.join(runsRoot(root), "ACTIVE"));
});

test("readActiveRunId returns null when no pointer, value when present", () => {
  const root = tmpProject();
  assert.equal(readActiveRunId(root), null);
  fs.mkdirSync(runsRoot(root), { recursive: true });
  fs.writeFileSync(activePointerPath(root), "run-7\n");
  assert.equal(readActiveRunId(root), "run-7");
});

test("createInitialState seeds ALIGN human gate", () => {
  const s = createInitialState({ runId: "r1", topic: "x", now: "2026-06-05T00:00:00Z" });
  assert.equal(s.phase, "ALIGN");
  assert.equal(s.gates.ALIGN.mode, "human");
  assert.equal(s.gates.ALIGN.status, "pending");
  assert.equal(s.createdAt, "2026-06-05T00:00:00Z");
});

test("validateState rejects bad mode/status", () => {
  const s = createInitialState({ runId: "r1", now: "t" });
  s.gates.ALIGN.mode = "bogus";
  assert.ok(validateState(s).some((e) => /invalid mode/.test(e)));
});

test("validateState rejects bad status", () => {
  const s = createInitialState({ runId: "r1", now: "t" });
  s.gates.ALIGN.status = "bogus";
  assert.ok(validateState(s).some((e) => /invalid status/.test(e)));
});

test("writeState/readState round-trips atomically", () => {
  const root = tmpProject();
  const dir = runDir(root, "r1");
  const s = createInitialState({ runId: "r1", now: "t" });
  writeState(dir, s);
  assert.ok(fs.existsSync(path.join(dir, "state.json")));
  const back = readState(dir);
  assert.equal(back.runId, "r1");
  const leftover = fs.readdirSync(dir).filter((f) => f.endsWith(".tmp"));
  assert.deepEqual(leftover, []);
});

test("getGate throws on unknown, addGate adds an auto gate", () => {
  const s = createInitialState({ runId: "r1", now: "t" });
  assert.throws(() => getGate(s, "nope"), /unknown gate/);
  addGate(s, "sprint-0-evidence", "auto");
  assert.equal(getGate(s, "sprint-0-evidence").mode, "auto");
  assert.equal(getGate(s, "sprint-0-evidence").status, "pending");
});
