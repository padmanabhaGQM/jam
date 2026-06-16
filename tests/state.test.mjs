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

test("validateState accepts absent or valid sprint allowedPaths", () => {
  const absent = createInitialState({ runId: "r1", now: "t" });
  absent.plan = { verifyCmd: "true", sprints: [{ id: "s1", title: "t", status: "pending" }] };
  assert.deepEqual(validateState(absent), []);

  const valid = createInitialState({ runId: "r2", now: "t" });
  valid.plan = { verifyCmd: "true", sprints: [{ id: "s1", title: "t", status: "pending", allowedPaths: ["lib/**"] }] };
  assert.deepEqual(validateState(valid), []);
});

test("validateState rejects malformed sprint allowedPaths", () => {
  const nonString = createInitialState({ runId: "r1", now: "t" });
  nonString.plan = { verifyCmd: "true", sprints: [{ id: "s1", title: "t", status: "pending", allowedPaths: [123] }] };
  assert.ok(validateState(nonString).some((e) => /allowedPaths entries must be non-empty strings/.test(e)));

  const emptyArray = createInitialState({ runId: "r2", now: "t" });
  emptyArray.plan = { verifyCmd: "true", sprints: [{ id: "s1", title: "t", status: "pending", allowedPaths: [] }] };
  assert.ok(validateState(emptyArray).some((e) => /allowedPaths must be a non-empty array/.test(e)));

  const nonArray = createInitialState({ runId: "r3", now: "t" });
  nonArray.plan = { verifyCmd: "true", sprints: [{ id: "s1", title: "t", status: "pending", allowedPaths: "lib/**" }] };
  assert.ok(validateState(nonArray).some((e) => /allowedPaths must be a non-empty array/.test(e)));
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
