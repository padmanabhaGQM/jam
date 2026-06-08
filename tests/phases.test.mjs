import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRun, recordDigest, recordApproval } from "../plugins/jam/scripts/lib/actions.mjs";
import { recordVerification } from "../plugins/jam/scripts/lib/control.mjs";
import { readState, writeState } from "../plugins/jam/scripts/lib/state.mjs";
import { advanceRun } from "../plugins/jam/scripts/lib/phases.mjs";

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), "jam-ph-")); }
function digest() {
  return { runId: "r1", phase: "DIAGNOSE", summary: "s",
    traceToArchitecture: { componentsTouched: ["A"], gapFromAgreed: null }, decisions: [],
    globalMap: { mermaid: "graph TD; A-->B", currentPosition: "A", isLocallyScopedRisk: false },
    coverage: { addressed: [], dropped: [] } };
}

test("cannot advance DIAGNOSE until its gate is approved", () => {
  const root = tmp();
  const dir = createRun({ projectRoot: root, runId: "r1", mode: "repair", now: "t" });
  assert.throws(() => advanceRun({ runDir: dir, now: "t1" }), /cannot advance from DIAGNOSE/);
});

test("DIAGNOSE→VERIFY→PLAN advances only as gates pass", () => {
  const root = tmp();
  const dir = createRun({ projectRoot: root, runId: "r1", mode: "repair", now: "t" });
  recordDigest({ runDir: dir, gateId: "DIAGNOSE", digest: digest(), now: "t1" });
  recordApproval({ runDir: dir, gateId: "DIAGNOSE", who: "neel", now: "t2" });
  advanceRun({ runDir: dir, now: "t3" });
  assert.equal(readState(dir).phase, "VERIFY");
  assert.ok(readState(dir).gates.VERIFY);

  assert.throws(() => advanceRun({ runDir: dir, now: "t4" }), /cannot advance from VERIFY/);
  recordVerification({ runDir: dir, gateId: "VERIFY", verdict: { unresolvedBlockers: 0 }, now: "t5" });
  recordApproval({ runDir: dir, gateId: "VERIFY", who: "neel", now: "t6" });
  advanceRun({ runDir: dir, now: "t7" });
  assert.equal(readState(dir).phase, "PLAN");
  assert.ok(readState(dir).gates.PLAN);
});

test("advancing from the final phase (IMPLEMENT) reports already-final, not a gate error", () => {
  const root = tmp();
  const dir = createRun({ projectRoot: root, runId: "r1", mode: "repair", now: "t" });
  const s = readState(dir); s.phase = "IMPLEMENT"; writeState(dir, s);
  assert.throws(() => advanceRun({ runDir: dir, now: "t1" }), /already at the final repair phase/);
});
