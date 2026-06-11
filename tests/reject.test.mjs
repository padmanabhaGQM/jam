import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createRun, recordDigest, recordApproval } from "../plugins/jam/scripts/lib/actions.mjs";
import { proposeAction, ratifyAction } from "../plugins/jam/scripts/lib/action.mjs";
import { rejectGate, rewindPhase } from "../plugins/jam/scripts/lib/control.mjs";
import { readState, writeState } from "../plugins/jam/scripts/lib/state.mjs";
import { evaluateGate } from "../plugins/jam/scripts/lib/gate.mjs";
import { evaluateAudit } from "../plugins/jam/scripts/lib/audit.mjs";
import { readLedger } from "../plugins/jam/scripts/lib/ledger.mjs";
import { advanceRun } from "../plugins/jam/scripts/lib/phases.mjs";

function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jam-rej-"));
  return createRun({ projectRoot: root, runId: "r1", mode: "repair", now: "t0" });
}

const digest = {
  runId: "r1",
  phase: "DIAGNOSE",
  summary: "s",
  traceToArchitecture: { componentsTouched: ["A"], gapFromAgreed: null },
  decisions: [],
  globalMap: { mermaid: "g", currentPosition: "A", isLocallyScopedRisk: false },
  coverage: { addressed: [], dropped: [] },
};

test("rejectGate records reason + ledger; approval over a rejection is impossible; re-render re-arms", () => {
  const dir = run();
  recordDigest({ runDir: dir, gateId: "DIAGNOSE", digest, now: "t1" });
  rejectGate({ runDir: dir, gateId: "DIAGNOSE", reason: "wrong root cause", now: "t2" });
  const s = readState(dir);
  assert.equal(s.gates.DIAGNOSE.status, "rejected");
  assert.equal(s.gates.DIAGNOSE.rejectedReason, "wrong root cause");
  assert.match(evaluateGate(s, "DIAGNOSE").reason, /rejected: wrong root cause/);
  assert.ok(readLedger(dir).some((e) => e.type === "gate-rejected" && e.reason === "wrong root cause"));
  assert.throws(() => recordApproval({ runDir: dir, gateId: "DIAGNOSE", who: "u", now: "t3" }), /status=rejected/);
  recordDigest({ runDir: dir, gateId: "DIAGNOSE", digest, now: "t4" });
  recordApproval({ runDir: dir, gateId: "DIAGNOSE", who: "u", now: "t5" });
  assert.equal(readState(dir).gates.DIAGNOSE.status, "approved");
});

test("rejectGate validation: unknown/non-human/tiebreak/ratified gates and missing/long reasons refused", () => {
  const dir = run();
  assert.throws(() => rejectGate({ runDir: dir, gateId: "nope", reason: "x" }), /unknown gate/);
  assert.throws(() => rejectGate({ runDir: dir, gateId: "DIAGNOSE", reason: "" }), /reason/);
  assert.throws(() => rejectGate({ runDir: dir, gateId: "DIAGNOSE", reason: "x".repeat(501) }), /500/);
  const s = readState(dir);
  s.gates["sprint-z"] = { mode: "auto", status: "pending", approvedBy: null, approvedAt: null, evidenceRef: null, approveFrom: "rendered" };
  s.gates["CONVERGE-tiebreak"] = { mode: "human", status: "pending", approvedBy: null, approvedAt: null, evidenceRef: null, approveFrom: "contested" };
  s.gates["action-z"] = { mode: "human", status: "pending", approvedBy: null, approvedAt: null, evidenceRef: null, approveFrom: "ratified" };
  writeState(dir, s);
  assert.throws(() => rejectGate({ runDir: dir, gateId: "sprint-z", reason: "x" }), /human/);
  assert.throws(() => rejectGate({ runDir: dir, gateId: "CONVERGE-tiebreak", reason: "x" }), /tiebreak/);
  assert.throws(() => rejectGate({ runDir: dir, gateId: "action-z", reason: "x" }), /deny/);
});

test("open rejection blocks later advancement; re-render resolves; denied action rejection is excluded", () => {
  const dir = run();
  recordDigest({ runDir: dir, gateId: "DIAGNOSE", digest, now: "t1" });
  recordApproval({ runDir: dir, gateId: "DIAGNOSE", who: "u", now: "t2" });
  advanceRun({ runDir: dir, now: "t3" });
  rejectGate({ runDir: dir, gateId: "DIAGNOSE", reason: "redo the diagnosis", now: "t4" });
  const s1 = readState(dir);
  s1.gates.VERIFY.status = "verified";
  writeState(dir, s1);
  recordApproval({ runDir: dir, gateId: "VERIFY", who: "u", now: "t5" });
  assert.throws(() => advanceRun({ runDir: dir, now: "t6" }), /rejected/);
  recordDigest({ runDir: dir, gateId: "DIAGNOSE", digest, now: "t7" });
  recordApproval({ runDir: dir, gateId: "DIAGNOSE", who: "u", now: "t8" });
  advanceRun({ runDir: dir, now: "t9" });
  assert.equal(readState(dir).phase, "PLAN");

  const deniedDir = run();
  proposeAction({ runDir: deniedDir, id: "drop-1", type: "delete", target: "/prod/db", now: "d1" });
  ratifyAction({ runDir: deniedDir, id: "drop-1", deny: true, now: "d2" });
  recordDigest({ runDir: deniedDir, gateId: "DIAGNOSE", digest, now: "d3" });
  recordApproval({ runDir: deniedDir, gateId: "DIAGNOSE", who: "u", now: "d4" });
  assert.doesNotThrow(() => advanceRun({ runDir: deniedDir, now: "d5" }));
});

test("reject an EARLIER phase's gate → advance blocked → rewind → re-produce → approve → re-advance", () => {
  const dir = run();
  recordDigest({ runDir: dir, gateId: "DIAGNOSE", digest, now: "t1" });
  recordApproval({ runDir: dir, gateId: "DIAGNOSE", who: "u", now: "t2" });
  advanceRun({ runDir: dir, now: "t3" });
  rejectGate({ runDir: dir, gateId: "DIAGNOSE", reason: "redo the diagnosis", now: "t4" });
  const s1 = readState(dir);
  s1.gates.VERIFY.status = "verified";
  writeState(dir, s1);
  recordApproval({ runDir: dir, gateId: "VERIFY", who: "u", now: "t5" });
  assert.throws(() => advanceRun({ runDir: dir, now: "t6" }), /rejected/);
  rewindPhase({ runDir: dir, toPhase: "DIAGNOSE", confirm: "DIAGNOSE", now: "t7" });
  recordDigest({ runDir: dir, gateId: "DIAGNOSE", digest, now: "t8" });
  recordApproval({ runDir: dir, gateId: "DIAGNOSE", who: "u", now: "t9" });
  advanceRun({ runDir: dir, now: "t10" });
  assert.equal(readState(dir).phase, "VERIFY");
});

test("audit rejects approval after gate-rejected without re-production and blocks FINISH with open rejection", () => {
  const forged = [
    { type: "digest-rendered", gateId: "DIAGNOSE" },
    { type: "gate-rejected", gateId: "DIAGNOSE", reason: "no" },
    { type: "approval", gateId: "DIAGNOSE" },
    { type: "phase-advanced", from: "DIAGNOSE", to: "VERIFY" },
  ];
  const r1 = evaluateAudit({ ledger: forged, state: { mode: "repair", phase: "VERIFY", plan: { sprints: [] } }, transcriptExists: () => true });
  assert.ok(r1.failures.some((f) => /rejected.*re-produc|re-produc.*reject/i.test(f)));
  const honest = [
    { type: "digest-rendered", gateId: "DIAGNOSE" },
    { type: "gate-rejected", gateId: "DIAGNOSE", reason: "no" },
    { type: "digest-rendered", gateId: "DIAGNOSE" },
    { type: "approval", gateId: "DIAGNOSE" },
    { type: "phase-advanced", from: "DIAGNOSE", to: "VERIFY" },
  ];
  const r2 = evaluateAudit({ ledger: honest, state: { mode: "repair", phase: "VERIFY", plan: { sprints: [] } }, transcriptExists: () => true });
  assert.ok(!r2.failures.some((f) => /rejected/i.test(f)));

  const finishOpen = evaluateAudit({
    ledger: [{ type: "final-verification", exitCode: 0 }],
    state: { mode: "repair", phase: "FINISH", gates: { DIAGNOSE: { status: "rejected" } }, plan: { sprints: [] }, actions: [] },
    transcriptExists: () => true,
  });
  assert.ok(finishOpen.failures.some((f) => /gate DIAGNOSE is rejected/));

  const finishDenied = evaluateAudit({
    ledger: [{ type: "final-verification", exitCode: 0 }],
    state: {
      mode: "repair",
      phase: "FINISH",
      gates: { "action-drop-1": { status: "rejected" } },
      plan: { sprints: [] },
      actions: [{ id: "drop-1", irreversible: true, status: "denied" }],
    },
    transcriptExists: () => true,
  });
  assert.ok(
    !finishDenied.failures.some((f) => /action-drop-1 is rejected/.test(f)),
    finishDenied.failures.join("; ")
  );
});
