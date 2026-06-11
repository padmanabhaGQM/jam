import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRun, recordDigest, recordApproval } from "../plugins/jam/scripts/lib/actions.mjs";
import { dialGate, recordVerification } from "../plugins/jam/scripts/lib/control.mjs";
import { readState, writeState } from "../plugins/jam/scripts/lib/state.mjs";
import { evaluateGate } from "../plugins/jam/scripts/lib/gate.mjs";
import { readLedger } from "../plugins/jam/scripts/lib/ledger.mjs";
import { advanceRun } from "../plugins/jam/scripts/lib/phases.mjs";
import { evaluateAudit } from "../plugins/jam/scripts/lib/audit.mjs";
import { convergeGrounding } from "../plugins/jam/scripts/lib/grounding.mjs";
import { recordDecision } from "../plugins/jam/scripts/lib/convergence.mjs";
import { certifyVerifyCmd, recordGameability, recordRedProof } from "../plugins/jam/scripts/lib/spec.mjs";
import { startSprint } from "../plugins/jam/scripts/lib/sprint.mjs";

function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jam-dial-"));
  return createRun({ projectRoot: root, runId: "r1", mode: "repair", now: "t0" });
}

function validDigest(phase = "DIAGNOSE") {
  return {
    runId: "r1",
    phase,
    summary: "s",
    traceToArchitecture: { componentsTouched: ["A"], gapFromAgreed: null },
    decisions: [],
    globalMap: { mermaid: "graph TD; A-->B", currentPosition: "A", isLocallyScopedRisk: false },
    coverage: { addressed: [], dropped: [] },
  };
}

const yes = () => true;

function greenfieldFinishLedgerWithDialedBuildPlan() {
  return [
    { type: "intent-sharpened" },
    { type: "grounding-converged" },
    { type: "approval", gateId: "GROUND-scope" },
    { type: "approval", gateId: "GROUND" },
    { type: "phase-advanced", from: "GROUND", to: "CONVERGE" },
    { type: "shortlist-set" },
    { type: "convergence-decided" },
    { type: "approval", gateId: "CONVERGE-shortlist" },
    { type: "approval", gateId: "CONVERGE" },
    { type: "phase-advanced", from: "CONVERGE", to: "SPECIFY" },
    { type: "coverage-set" },
    { type: "spec-certified", verifyCmd: "true" },
    { type: "approval", gateId: "SPECIFY-coverage" },
    { type: "approval", gateId: "SPECIFY" },
    { type: "phase-advanced", from: "SPECIFY", to: "BUILD" },
    { type: "gate-dialed", gateId: "BUILD-plan", from: "human", to: "show-and-proceed" },
    { type: "plan-recorded", sprints: 1, sprintIds: ["b1"] },
    { type: "sprint-started", sprintId: "b1" },
    { type: "codex-bound", sprintId: "b1" },
    { type: "evidence", sprintId: "b1", gateId: "sprint-b1", exitCode: 0 },
    { type: "sprint-done", sprintId: "b1" },
    { type: "final-verification", command: "true", exitCode: 0 },
    { type: "phase-advanced", from: "BUILD", to: "FINISH" },
  ];
}

function greenfieldFinishStateWithDialedBuildPlan() {
  return {
    mode: "greenfield",
    phase: "FINISH",
    spec: { certified: true, verifyCmd: "true" },
    plan: {
      verifyCmd: "true",
      sprints: [{ id: "b1", status: "done", provenance: "planned", codexSessions: [{ transcriptPath: "/x.jsonl" }] }],
    },
    promotions: [],
    gates: { "BUILD-plan": { mode: "show-and-proceed", status: "planned", approveFrom: "planned" } },
  };
}

test("dial: loosening human -> show-and-proceed needs typed confirm; ledger entry", () => {
  const dir = run();
  assert.throws(() => dialGate({ runDir: dir, gateId: "DIAGNOSE", mode: "show-and-proceed" }), /confirm/);
  dialGate({ runDir: dir, gateId: "DIAGNOSE", mode: "show-and-proceed", confirm: "DIAGNOSE", now: "t1" });
  assert.equal(readState(dir).gates.DIAGNOSE.mode, "show-and-proceed");
  assert.ok(readLedger(dir).some((e) => e.type === "gate-dialed" && e.to === "show-and-proceed"));
});

test("dial: tightening back to human is free", () => {
  const dir = run();
  dialGate({ runDir: dir, gateId: "DIAGNOSE", mode: "show-and-proceed", confirm: "DIAGNOSE" });
  dialGate({ runDir: dir, gateId: "DIAGNOSE", mode: "human" });               // no confirm needed
  assert.equal(readState(dir).gates.DIAGNOSE.mode, "human");
});

test("dial: fail-safe floors - ratification gates, sprint gates, and ->auto are refused", () => {
  const dir = run();
  // actions.addGate IGNORES approveFrom (verified) - create the special gates via state-level write.
  const s = readState(dir);
  s.gates["action-x"] = { mode: "human", status: "pending", approvedBy: null, approvedAt: null, evidenceRef: null, approveFrom: "ratified" };
  s.gates["sprint-s1"] = { mode: "auto", status: "pending", approvedBy: null, approvedAt: null, evidenceRef: null, approveFrom: "rendered" };
  writeState(dir, s);
  assert.throws(() => dialGate({ runDir: dir, gateId: "action-x", mode: "show-and-proceed", confirm: "action-x" }), /ratif/i);
  assert.throws(() => dialGate({ runDir: dir, gateId: "sprint-s1", mode: "human" }), /sprint/i);
  // non-sprint auto gate: tightening to human is ALLOWED
  const s2 = readState(dir);
  s2.gates["custom-evidence"] = { mode: "auto", status: "pending", approvedBy: null, approvedAt: null, evidenceRef: null, approveFrom: "rendered" };
  writeState(dir, s2);
  dialGate({ runDir: dir, gateId: "custom-evidence", mode: "human" });
  assert.equal(readState(dir).gates["custom-evidence"].mode, "human");
  assert.throws(() => dialGate({ runDir: dir, gateId: "DIAGNOSE", mode: "auto", confirm: "DIAGNOSE" }), /auto/i);
});

test("B6: a dialed-down greenfield gate stays SATISFIABLE - show-and-proceed accepts its approveFrom status", () => {
  // a greenfield-style gate whose produced status is its approveFrom value (e.g. "covered")
  const state = { gates: { "SPECIFY-coverage": { mode: "show-and-proceed", status: "covered", approveFrom: "covered" } } };
  assert.equal(evaluateGate(state, "SPECIFY-coverage").allowed, true);
  // and still blocked while pending
  state.gates["SPECIFY-coverage"].status = "pending";
  assert.equal(evaluateGate(state, "SPECIFY-coverage").allowed, false);
});

test("dialed-down VERIFY can record verification and advance without an approval entry", () => {
  const dir = run();
  recordDigest({ runDir: dir, gateId: "DIAGNOSE", digest: validDigest(), now: "t1" });
  recordApproval({ runDir: dir, gateId: "DIAGNOSE", who: "u", now: "t2" });
  advanceRun({ runDir: dir, now: "t3" });
  dialGate({ runDir: dir, gateId: "VERIFY", mode: "show-and-proceed", confirm: "VERIFY", now: "t4" });
  recordVerification({ runDir: dir, gateId: "VERIFY", verdict: { unresolvedBlockers: 0 }, now: "t5" });
  advanceRun({ runDir: dir, now: "t6" });
  assert.equal(readState(dir).phase, "PLAN");
});

test("audit accepts a dialed-down gate with a fresh artifact and no approval", () => {
  const ledger = [
    { type: "digest-rendered", gateId: "DIAGNOSE" },
    { type: "gate-dialed", gateId: "DIAGNOSE", from: "human", to: "show-and-proceed" },
    { type: "phase-advanced", from: "DIAGNOSE", to: "VERIFY" },
  ];
  const r = evaluateAudit({ ledger, state: { mode: "repair", phase: "VERIFY", gates: {} }, transcriptExists: yes });
  assert.deepEqual(r.failures, []);
});

test("audit rejects a dialed-down gate when a later dial-up revokes delegation before advance", () => {
  const ledger = [
    { type: "digest-rendered", gateId: "DIAGNOSE" },
    { type: "gate-dialed", gateId: "DIAGNOSE", from: "human", to: "show-and-proceed" },
    { type: "gate-dialed", gateId: "DIAGNOSE", from: "show-and-proceed", to: "human" },
    { type: "phase-advanced", from: "DIAGNOSE", to: "VERIFY" },
  ];
  const r = evaluateAudit({ ledger, state: { mode: "repair", phase: "VERIFY", gates: {} }, transcriptExists: yes });
  assert.ok(r.failures.some((f) => /no preceding approval/.test(f)));
});

test("audit accepts a dialed-down BUILD-plan state and ledger at FINISH", () => {
  const r = evaluateAudit({
    ledger: greenfieldFinishLedgerWithDialedBuildPlan(),
    state: greenfieldFinishStateWithDialedBuildPlan(),
    transcriptExists: yes,
  });
  assert.deepEqual(r.failures, []);
});

test("greenfield prerequisites use gate evaluation for dialed-down GROUND-scope", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jam-dial-gf-"));
  const dir = createRun({ projectRoot: root, runId: "r1", mode: "greenfield", now: "t0" });
  const s = readState(dir);
  s.grounding.problem = "p";
  s.grounding.dimensions = ["d"];
  s.gates["GROUND-scope"].mode = "show-and-proceed";
  s.gates["GROUND-scope"].status = "scoped";
  writeState(dir, s);
  assert.doesNotThrow(() => convergeGrounding({ runDir: dir, now: "t1" }));
});

test("greenfield prerequisites use gate evaluation for dialed-down CONVERGE-shortlist", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jam-dial-gf-"));
  const dir = createRun({ projectRoot: root, runId: "r1", mode: "greenfield", now: "t0" });
  const s = readState(dir);
  s.phase = "CONVERGE";
  s.convergence = { shortlist: ["a"], decisions: {}, agree: null, tiebreak: null, chosen: null, ledger: [], spikes: [], acceptedUnknowns: [], decided: false };
  s.gates = {
    "CONVERGE-shortlist": { mode: "show-and-proceed", status: "shortlisted", approvedBy: null, approvedAt: null, evidenceRef: null, approveFrom: "shortlisted" },
    CONVERGE: { mode: "human", status: "pending", approvedBy: null, approvedAt: null, evidenceRef: null, approveFrom: "decided" },
  };
  writeState(dir, s);
  assert.doesNotThrow(() => recordDecision({ runDir: dir, agent: "claude", chosen: "a", now: "t1" }));
});

test("greenfield prerequisites use gate evaluation for dialed-down SPECIFY-coverage", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jam-dial-gf-"));
  const dir = createRun({ projectRoot: root, runId: "r1", mode: "greenfield", now: "t0" });
  const s = readState(dir);
  s.phase = "SPECIFY";
  s.convergence = { ledger: [{ dimension: "d", status: "unmet", accepted: true }] };
  s.spec = { verifyCmd: "node -e \"process.exit(1)\"", checks: [{ id: "c", dimension: "d", ref: "tests/x.test.mjs" }], redProof: null, gameability: null, certified: false };
  s.gates = {
    "SPECIFY-coverage": { mode: "show-and-proceed", status: "covered", approvedBy: null, approvedAt: null, evidenceRef: null, approveFrom: "covered" },
    SPECIFY: { mode: "human", status: "pending", approvedBy: null, approvedAt: null, evidenceRef: null, approveFrom: "specified" },
  };
  writeState(dir, s);
  recordRedProof({ runDir: dir, cwd: root, now: "t1" });
  recordGameability({ runDir: dir, reviewer: "codex", author: "claude", survivingFindings: 0, now: "t2" });
  assert.doesNotThrow(() => certifyVerifyCmd({ runDir: dir, cwd: root, now: "t3" }));
});

test("greenfield prerequisites use gate evaluation for dialed-down BUILD-plan", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jam-dial-gf-"));
  const dir = createRun({ projectRoot: root, runId: "r1", mode: "greenfield", now: "t0" });
  const s = readState(dir);
  s.phase = "BUILD";
  s.spec = { certified: true, verifyCmd: "true" };
  s.plan = { verifyCmd: "true", sprints: [{ id: "b1", title: "b", status: "pending", provenance: "planned" }] };
  s.gates = { "BUILD-plan": { mode: "show-and-proceed", status: "planned", approvedBy: null, approvedAt: null, evidenceRef: null, approveFrom: "planned" } };
  writeState(dir, s);
  startSprint({ runDir: dir, sprintId: "b1", now: "t1" });
  assert.equal(readState(dir).plan.sprints[0].status, "in-progress");
});
