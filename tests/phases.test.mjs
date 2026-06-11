import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRun, recordDigest, recordApproval } from "../plugins/jam/scripts/lib/actions.mjs";
import { recordVerification } from "../plugins/jam/scripts/lib/control.mjs";
import { readState, writeState } from "../plugins/jam/scripts/lib/state.mjs";
import { advanceRun } from "../plugins/jam/scripts/lib/phases.mjs";
import { appendLedger } from "../plugins/jam/scripts/lib/ledger.mjs";

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

test("IMPLEMENT advances to FINISH only when all sprints are done", () => {
  const root = tmp();
  const dir = createRun({ projectRoot: root, runId: "r1", mode: "repair", now: "t" });
  const s = readState(dir);
  s.phase = "IMPLEMENT";
  s.plan = { verifyCmd: "true", sprints: [{ id: "a", title: "t", status: "pending" }] };
  writeState(dir, s);
  // honest phase history — the repair complete-prefix audit requires producers+approvals+advances
  appendLedger(dir, { at: "t", type: "digest-rendered", gateId: "DIAGNOSE" });
  appendLedger(dir, { at: "t", type: "approval", gateId: "DIAGNOSE" });
  appendLedger(dir, { at: "t", type: "phase-advanced", from: "DIAGNOSE", to: "VERIFY" });
  appendLedger(dir, { at: "t", type: "verification", gateId: "VERIFY", blockers: 0 });
  appendLedger(dir, { at: "t", type: "approval", gateId: "VERIFY" });
  appendLedger(dir, { at: "t", type: "phase-advanced", from: "VERIFY", to: "PLAN" });
  appendLedger(dir, { at: "t", type: "plan-recorded" });
  appendLedger(dir, { at: "t", type: "approval", gateId: "PLAN" });
  appendLedger(dir, { at: "t", type: "phase-advanced", from: "PLAN", to: "IMPLEMENT" });
  assert.throws(() => advanceRun({ runDir: dir, now: "t1" }), /not all sprints done/);
  const tp = path.join(root, "transcript.jsonl");
  fs.writeFileSync(tp, "{}\n");
  const s2 = readState(dir);
  s2.plan.sprints[0].status = "done";
  s2.plan.sprints[0].provenance = "planned";
  s2.plan.sprints[0].codexSessions = [{ sessionId: "s", transcriptPath: tp, at: "t" }];
  writeState(dir, s2);
  appendLedger(dir, { at: "t", type: "sprint-started", sprintId: "a" });
  appendLedger(dir, { at: "t", type: "codex-bound", sprintId: "a", sessionId: "s" });
  appendLedger(dir, { at: "t", type: "evidence", gateId: "sprint-a", sprintId: "a", exitCode: 0 });
  appendLedger(dir, { at: "t", type: "sprint-done", sprintId: "a" });
  advanceRun({ runDir: dir, now: "t2" });
  assert.equal(readState(dir).phase, "FINISH");
});

test("advancing from FINISH (terminal) reports already-final", () => {
  const root = tmp();
  const dir = createRun({ projectRoot: root, runId: "r1", mode: "repair", now: "t" });
  const s = readState(dir); s.phase = "FINISH"; writeState(dir, s);
  assert.throws(() => advanceRun({ runDir: dir, now: "t1" }), /already at the final repair phase/);
});
