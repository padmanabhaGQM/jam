import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createRun, recordDigest, recordApproval } from "../plugins/jam/scripts/lib/actions.mjs";
import { recordPlan } from "../plugins/jam/scripts/lib/plan.mjs";
import { recordVerification, rewindPhase } from "../plugins/jam/scripts/lib/control.mjs";
import { startSprint } from "../plugins/jam/scripts/lib/sprint.mjs";
import { advanceRun } from "../plugins/jam/scripts/lib/phases.mjs";
import { readState } from "../plugins/jam/scripts/lib/state.mjs";
import { readLedger } from "../plugins/jam/scripts/lib/ledger.mjs";
import { evaluateAudit } from "../plugins/jam/scripts/lib/audit.mjs";

const digest = {
  runId: "r1",
  phase: "DIAGNOSE",
  summary: "s",
  traceToArchitecture: { componentsTouched: ["A"], gapFromAgreed: null },
  decisions: [],
  globalMap: { mermaid: "g", currentPosition: "A", isLocallyScopedRisk: false },
  coverage: { addressed: [], dropped: [] },
};

const plan = {
  verifyCmd: "true",
  sprints: [{ id: "fix-1", title: "Fix one", acceptanceCriteria: "done" }],
};

function repairRun() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jam-rw-"));
  return createRun({ projectRoot: root, runId: "r1", mode: "repair", now: "t0" });
}

function atVerify() {
  const dir = repairRun();
  recordDigest({ runDir: dir, gateId: "DIAGNOSE", digest, now: "t1" });
  recordApproval({ runDir: dir, gateId: "DIAGNOSE", who: "u", now: "t2" });
  advanceRun({ runDir: dir, now: "t3" });
  return dir;
}

function atImplement() {
  const dir = atVerify();
  recordVerification({ runDir: dir, gateId: "VERIFY", verdict: { unresolvedBlockers: 0 }, now: "t4" });
  recordApproval({ runDir: dir, gateId: "VERIFY", who: "u", now: "t5" });
  advanceRun({ runDir: dir, now: "t6" });
  recordPlan({ runDir: dir, plan, now: "t7" });
  recordApproval({ runDir: dir, gateId: "PLAN", who: "u", now: "t8" });
  advanceRun({ runDir: dir, now: "t9" });
  return dir;
}

test("rewindPhase: backward-only + typed confirm; re-arms later gates; ledger entry", () => {
  const dir = atVerify();
  assert.throws(() => rewindPhase({ runDir: dir, toPhase: "PLAN", confirm: "PLAN" }), /earlier/);
  assert.throws(() => rewindPhase({ runDir: dir, toPhase: "DIAGNOSE", confirm: "WRONG" }), /confirm/);
  rewindPhase({ runDir: dir, toPhase: "DIAGNOSE", confirm: "DIAGNOSE", now: "t4" });
  const s = readState(dir);
  assert.equal(s.phase, "DIAGNOSE");
  assert.equal(s.gates.DIAGNOSE.status, "pending");
  assert.equal(s.gates.DIAGNOSE.mode, "human");
  assert.equal(s.gates.VERIFY, undefined);
  assert.ok(readLedger(dir).some((e) => e.type === "phase-rewound" && e.from === "VERIFY" && e.to === "DIAGNOSE"));
});

test("live loop after rewind: re-produce, re-approve, re-advance works end-to-end", () => {
  const dir = atVerify();
  rewindPhase({ runDir: dir, toPhase: "DIAGNOSE", confirm: "DIAGNOSE", now: "t4" });
  recordDigest({ runDir: dir, gateId: "DIAGNOSE", digest, now: "t5" });
  recordApproval({ runDir: dir, gateId: "DIAGNOSE", who: "u", now: "t6" });
  advanceRun({ runDir: dir, now: "t7" });
  assert.equal(readState(dir).phase, "VERIFY");
});

test("plan epoch: re-recording a plan deletes stale sprint gates so same sprint id can restart", () => {
  const dir = atImplement();
  startSprint({ runDir: dir, sprintId: "fix-1", now: "t10" });
  rewindPhase({ runDir: dir, toPhase: "PLAN", confirm: "PLAN", now: "t11" });
  recordPlan({ runDir: dir, plan, now: "t12" });
  recordApproval({ runDir: dir, gateId: "PLAN", who: "u", now: "t13" });
  advanceRun({ runDir: dir, now: "t14" });
  assert.doesNotThrow(() => startSprint({ runDir: dir, sprintId: "fix-1", now: "t15" }));
  const s = readState(dir);
  assert.deepEqual(Object.keys(s.gates).filter((id) => id === "sprint-fix-1"), ["sprint-fix-1"]);
  assert.equal(s.gates["sprint-fix-1"].status, "pending");
});

test("AUDIT: rewind-aware walk — honest rewound ledger passes; forged re-advance on PRE-rewind artifacts fails", () => {
  const honest = [
    { type: "digest-rendered", gateId: "DIAGNOSE" }, { type: "approval", gateId: "DIAGNOSE" },
    { type: "phase-advanced", from: "DIAGNOSE", to: "VERIFY" },
    { type: "phase-rewound", from: "VERIFY", to: "DIAGNOSE" },
    { type: "digest-rendered", gateId: "DIAGNOSE" }, { type: "approval", gateId: "DIAGNOSE" },
    { type: "phase-advanced", from: "DIAGNOSE", to: "VERIFY" },
  ];
  const r1 = evaluateAudit({ ledger: honest, state: { mode: "repair", phase: "VERIFY", plan: { sprints: [] } }, transcriptExists: () => true });
  assert.deepEqual(r1.failures.filter((f) => /ordering/.test(f)), []);

  const forged = [
    { type: "digest-rendered", gateId: "DIAGNOSE" }, { type: "approval", gateId: "DIAGNOSE" },
    { type: "phase-advanced", from: "DIAGNOSE", to: "VERIFY" },
    { type: "phase-rewound", from: "VERIFY", to: "DIAGNOSE" },
    { type: "phase-advanced", from: "DIAGNOSE", to: "VERIFY" },
  ];
  const r2 = evaluateAudit({ ledger: forged, state: { mode: "repair", phase: "VERIFY", plan: { sprints: [] } }, transcriptExists: () => true });
  assert.ok(r2.failures.some((f) => /after.*rewind|rewind.*stale|no preceding approval/.test(f)));
});

test("AUDIT: invalid rewind direction in a forged ledger fails", () => {
  const led = [{ type: "phase-rewound", from: "DIAGNOSE", to: "VERIFY" }];
  const r = evaluateAudit({ ledger: led, state: { mode: "repair", phase: "VERIFY", plan: { sprints: [] } }, transcriptExists: () => true });
  assert.ok(r.failures.some((f) => /rewound.*not.*earlier|invalid rewind/i.test(f)));
});

test("AUDIT red-team: terminal rewind requires target phase gates reset pending and human", () => {
  const led = [
    { type: "digest-rendered", gateId: "DIAGNOSE" }, { type: "approval", gateId: "DIAGNOSE" },
    { type: "phase-advanced", from: "DIAGNOSE", to: "VERIFY" },
    { type: "phase-rewound", from: "VERIFY", to: "DIAGNOSE" },
  ];
  const staleApproved = evaluateAudit({
    ledger: led,
    state: {
      mode: "repair",
      phase: "DIAGNOSE",
      gates: { DIAGNOSE: { mode: "human", status: "approved", approveFrom: "rendered" } },
      plan: { sprints: [] },
    },
    transcriptExists: () => true,
  });
  assert.ok(staleApproved.failures.some((f) => /rewind.*DIAGNOSE.*pending.*human/i.test(f)));

  const staleDialed = evaluateAudit({
    ledger: led,
    state: {
      mode: "repair",
      phase: "DIAGNOSE",
      gates: { DIAGNOSE: { mode: "show-and-proceed", status: "pending", approveFrom: "rendered" } },
      plan: { sprints: [] },
    },
    transcriptExists: () => true,
  });
  assert.ok(staleDialed.failures.some((f) => /rewind.*DIAGNOSE.*pending.*human/i.test(f)));
});

test("AUDIT red-team (B1): an advance using an approval that PREDATES a rejection of that gate fails", () => {
  const forged = [
    { type: "digest-rendered", gateId: "DIAGNOSE" },
    { type: "approval", gateId: "DIAGNOSE" },
    { type: "gate-rejected", gateId: "DIAGNOSE", reason: "changed my mind" },
    { type: "phase-advanced", from: "DIAGNOSE", to: "VERIFY" },
  ];
  const r = evaluateAudit({ ledger: forged, state: { mode: "repair", phase: "VERIFY", plan: { sprints: [] } }, transcriptExists: () => true });
  assert.ok(r.failures.some((f) => /no preceding approval|approval/.test(f)));
});

test("AUDIT red-team (B4): greenfield re-advance reusing a PRE-REWIND required sub-gate approval fails", () => {
  const forged = [
    { type: "intent-sharpened" }, { type: "approval", gateId: "GROUND-scope" },
    { type: "grounding-converged" }, { type: "approval", gateId: "GROUND" },
    { type: "phase-advanced", from: "GROUND", to: "CONVERGE" },
    { type: "phase-rewound", from: "CONVERGE", to: "GROUND" },
    { type: "grounding-converged" }, { type: "approval", gateId: "GROUND" },
    { type: "phase-advanced", from: "GROUND", to: "CONVERGE" },
  ];
  const r = evaluateAudit({ ledger: forged, state: { mode: "greenfield", phase: "CONVERGE", plan: { sprints: [] } }, transcriptExists: () => true });
  assert.ok(r.failures.some((f) => /GROUND-scope/.test(f)));
});

test("AUDIT greenfield required gate can use active delegation with a fresh artifact", () => {
  const led = [
    { type: "gate-dialed", gateId: "GROUND-scope", to: "show-and-proceed" },
    { type: "intent-sharpened" },
    { type: "grounding-converged" }, { type: "approval", gateId: "GROUND" },
    { type: "phase-advanced", from: "GROUND", to: "CONVERGE" },
  ];
  const r = evaluateAudit({ ledger: led, state: { mode: "greenfield", phase: "CONVERGE", plan: { sprints: [] } }, transcriptExists: () => true });
  assert.ok(!r.failures.some((f) => /GROUND-scope/.test(f)));
});

test("AUDIT red-team (R2-B1): a forged rewind FROM a phase the run never reached fails", () => {
  const led = [
    { type: "digest-rendered", gateId: "DIAGNOSE" }, { type: "approval", gateId: "DIAGNOSE" },
    { type: "phase-advanced", from: "DIAGNOSE", to: "VERIFY" },
    { type: "phase-rewound", from: "FINISH", to: "DIAGNOSE" },
  ];
  const r = evaluateAudit({ ledger: led, state: { mode: "repair", phase: "DIAGNOSE", plan: { sprints: [] } }, transcriptExists: () => true });
  assert.ok(r.failures.some((f) => /forged rewind origin|rewound from/i.test(f)));
});

test("AUDIT red-team (R2-B2): greenfield refinish reusing a PRE-REWIND plan-recorded fails", () => {
  const sp = { id: "b1", status: "done", provenance: "planned", codexSessions: [{ transcriptPath: "/x" }] };
  const led = [
    { type: "plan-recorded", sprintIds: ["b1"] }, { type: "approval", gateId: "BUILD-plan" },
    { type: "sprint-started", sprintId: "b1" }, { type: "codex-bound", sprintId: "b1" },
    { type: "evidence", sprintId: "b1", gateId: "sprint-b1", exitCode: 0 }, { type: "sprint-done", sprintId: "b1" },
    { type: "final-verification", exitCode: 0 },
    { type: "phase-advanced", from: "BUILD", to: "FINISH" },
    { type: "phase-rewound", from: "FINISH", to: "BUILD" },
    { type: "approval", gateId: "BUILD-plan" },
    { type: "final-verification", exitCode: 0 },
    { type: "phase-advanced", from: "BUILD", to: "FINISH" },
  ];
  const st = {
    mode: "greenfield",
    phase: "FINISH",
    spec: { certified: true, verifyCmd: "true" },
    plan: { verifyCmd: "true", sprints: [sp] },
    gates: { "BUILD-plan": { mode: "human", status: "approved", approveFrom: "planned" } },
  };
  const r = evaluateAudit({ ledger: led, state: st, transcriptExists: () => true });
  assert.ok(r.failures.some((f) => /plan-recorded/.test(f)));
});

test("AUDIT red-team (R2-B3): CONVERGE re-advance without a FRESH tiebreak ruling fails", () => {
  const led = [
    { type: "shortlist-set" }, { type: "approval", gateId: "CONVERGE-shortlist" },
    { type: "tiebreak-ruled" },
    { type: "convergence-decided" }, { type: "approval", gateId: "CONVERGE" },
    { type: "phase-advanced", from: "CONVERGE", to: "SPECIFY" },
    { type: "phase-rewound", from: "SPECIFY", to: "CONVERGE" },
    { type: "shortlist-set" }, { type: "approval", gateId: "CONVERGE-shortlist" },
    { type: "convergence-decided" }, { type: "approval", gateId: "CONVERGE" },
    { type: "phase-advanced", from: "CONVERGE", to: "SPECIFY" },
  ];
  const st = {
    mode: "greenfield",
    phase: "SPECIFY",
    plan: { sprints: [] },
    gates: { "CONVERGE-tiebreak": { mode: "human", status: "contested", approveFrom: "contested" } },
  };
  const r = evaluateAudit({ ledger: led, state: st, transcriptExists: () => true });
  assert.ok(r.failures.some((f) => /tiebreak/i.test(f)));
});

test("AUDIT red-team (R5-B1): post-rewind sub-gate APPROVAL with a STALE pre-rewind producer fails", () => {
  const led = [
    { type: "intent-sharpened" }, { type: "approval", gateId: "GROUND-scope" },
    { type: "grounding-converged" }, { type: "approval", gateId: "GROUND" },
    { type: "phase-advanced", from: "GROUND", to: "CONVERGE" },
    { type: "phase-rewound", from: "CONVERGE", to: "GROUND" },
    { type: "approval", gateId: "GROUND-scope" },
    { type: "grounding-converged" }, { type: "approval", gateId: "GROUND" },
    { type: "phase-advanced", from: "GROUND", to: "CONVERGE" },
  ];
  const r = evaluateAudit({ ledger: led, state: { mode: "greenfield", phase: "CONVERGE", plan: { sprints: [] } }, transcriptExists: () => true });
  assert.ok(r.failures.some((f) => /GROUND-scope/.test(f)));
});

test("AUDIT red-team (B5): a rewound-and-refinished run reusing a PRE-REWIND final-verification fails", () => {
  const sp = { id: "s1", status: "done", provenance: "planned", codexSessions: [{ transcriptPath: "/x" }] };
  const forged = [
    { type: "sprint-started", sprintId: "s1" }, { type: "codex-bound", sprintId: "s1" },
    { type: "evidence", sprintId: "s1", gateId: "sprint-s1", exitCode: 0 }, { type: "sprint-done", sprintId: "s1" },
    { type: "final-verification", command: "true", exitCode: 0 },
    { type: "phase-advanced", from: "IMPLEMENT", to: "FINISH" },
    { type: "phase-rewound", from: "FINISH", to: "IMPLEMENT" },
    { type: "phase-advanced", from: "IMPLEMENT", to: "FINISH" },
  ];
  const r = evaluateAudit({ ledger: forged, state: { mode: "repair", phase: "FINISH", plan: { verifyCmd: "true", sprints: [sp] } }, transcriptExists: () => true });
  assert.ok(r.failures.some((f) => /final-verification/.test(f)));
});

test("AUDIT plan epoch: old sprint-done cannot satisfy the current plan", () => {
  const sp = { id: "fix-1", status: "done", provenance: "planned", codexSessions: [{ transcriptPath: "/x" }] };
  const currentEpoch = [
    { type: "digest-rendered", gateId: "DIAGNOSE" }, { type: "approval", gateId: "DIAGNOSE" },
    { type: "phase-advanced", from: "DIAGNOSE", to: "VERIFY" },
    { type: "verification", gateId: "VERIFY", blockers: 0 }, { type: "approval", gateId: "VERIFY" },
    { type: "phase-advanced", from: "VERIFY", to: "PLAN" },
    { type: "plan-recorded", sprintIds: ["fix-1"] },
    { type: "approval", gateId: "PLAN" },
    { type: "phase-advanced", from: "PLAN", to: "IMPLEMENT" },
    { type: "sprint-started", sprintId: "fix-1" }, { type: "codex-bound", sprintId: "fix-1" },
    { type: "evidence", sprintId: "fix-1", gateId: "sprint-fix-1", exitCode: 0 }, { type: "sprint-done", sprintId: "fix-1" },
    { type: "phase-rewound", from: "IMPLEMENT", to: "PLAN" },
    { type: "plan-recorded", sprintIds: ["fix-1"] },
    { type: "approval", gateId: "PLAN" },
    { type: "phase-advanced", from: "PLAN", to: "IMPLEMENT" },
    { type: "sprint-started", sprintId: "fix-1" }, { type: "codex-bound", sprintId: "fix-1" },
    { type: "evidence", sprintId: "fix-1", gateId: "sprint-fix-1", exitCode: 0 }, { type: "sprint-done", sprintId: "fix-1" },
  ];
  const state = { mode: "repair", phase: "IMPLEMENT", plan: { verifyCmd: "true", sprints: [sp] } };
  const ok = evaluateAudit({ ledger: currentEpoch, state, transcriptExists: () => true });
  assert.equal(ok.ok, true, ok.failures.join("; "));

  const staleOnly = currentEpoch.slice(0, -1);
  const fail = evaluateAudit({ ledger: staleOnly, state, transcriptExists: () => true });
  assert.ok(fail.failures.some((f) => /sprint fix-1 is done in state but has no sprint-done/.test(f)));
});
