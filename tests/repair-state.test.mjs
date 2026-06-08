import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInitialState, validateState } from "../plugins/jam/scripts/lib/state.mjs";
import { runDir, readActiveRunId } from "../plugins/jam/scripts/lib/paths.mjs";
import { readState } from "../plugins/jam/scripts/lib/state.mjs";
import { createRun } from "../plugins/jam/scripts/lib/actions.mjs";

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), "jam-rs-")); }

test("greenfield (no mode) still seeds ALIGN", () => {
  const s = createInitialState({ runId: "r1", now: "t" });
  assert.equal(s.phase, "ALIGN");
  assert.ok(s.gates.ALIGN);
});

test("repair mode seeds DIAGNOSE phase + gate + repair fields", () => {
  const s = createInitialState({ runId: "r1", now: "t", mode: "repair" });
  assert.equal(s.phase, "DIAGNOSE");
  assert.equal(s.gates.DIAGNOSE.mode, "human");
  assert.equal(s.gates.DIAGNOSE.status, "pending");
  assert.equal(s.mode, "repair");
  assert.equal(s.goalRef, null);
});

test("validateState accepts the 'verified' status", () => {
  const s = createInitialState({ runId: "r1", now: "t", mode: "repair" });
  s.gates.DIAGNOSE.status = "verified";
  assert.doesNotThrow(() => validateState(s));
});

test("createRun passes mode through to repair", () => {
  const root = tmp();
  const dir = createRun({ projectRoot: root, runId: "r1", mode: "repair", now: "t" });
  assert.equal(readActiveRunId(root), "r1");
  assert.equal(readState(dir).phase, "DIAGNOSE");
});
