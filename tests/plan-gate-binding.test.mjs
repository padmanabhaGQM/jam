import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInitialState, validateState, addGate, readState, writeState } from "../plugins/jam/scripts/lib/state.mjs";
import { advancePhase } from "../plugins/jam/scripts/lib/phases.mjs";
import { createRun, recordDigest, recordApproval } from "../plugins/jam/scripts/lib/actions.mjs";

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), "jam-pgb-")); }
function digest() {
  return { runId: "r1", phase: "X", summary: "s", traceToArchitecture: { componentsTouched: ["A"], gapFromAgreed: null },
    decisions: [], globalMap: { mermaid: "graph TD; A-->B", currentPosition: "A", isLocallyScopedRisk: false }, coverage: { addressed: [], dropped: [] } };
}

test("validateState accepts the 'planned' status", () => {
  const s = createInitialState({ runId: "r1", now: "t", mode: "repair" });
  s.gates.DIAGNOSE.status = "planned";
  assert.doesNotThrow(() => validateState(s));
});

test("advancePhase seeds VERIFY as verified-bound and PLAN as planned-bound", () => {
  const s = createInitialState({ runId: "r1", now: "t", mode: "repair" });
  s.gates.DIAGNOSE.status = "approved";
  advancePhase(s);
  assert.equal(s.phase, "VERIFY");
  assert.equal(s.gates.VERIFY.approveFrom, "verified");
  s.gates.VERIFY.status = "approved";
  advancePhase(s);
  assert.equal(s.phase, "PLAN");
  assert.equal(s.gates.PLAN.approveFrom, "planned");
});

test("recordDigest applies ONLY to rendered-bound gates", () => {
  const root = tmp();
  const dir = createRun({ projectRoot: root, runId: "r1", mode: "repair", now: "t" });
  const s = readState(dir);
  addGate(s, "PLAN", "human", "planned");
  addGate(s, "V", "human", "verified");
  writeState(dir, s);
  assert.throws(() => recordDigest({ runDir: dir, gateId: "PLAN", digest: digest() }), /not a digest/);
  assert.throws(() => recordDigest({ runDir: dir, gateId: "V", digest: digest() }), /not a digest/);
  recordDigest({ runDir: dir, gateId: "DIAGNOSE", digest: digest() });
  assert.equal(readState(dir).gates.DIAGNOSE.status, "rendered");
});

test("approving a planned gate before a plan reports 'plan not recorded'", () => {
  const root = tmp();
  const dir = createRun({ projectRoot: root, runId: "r1", mode: "repair", now: "t" });
  const s = readState(dir); addGate(s, "PLAN", "human", "planned"); writeState(dir, s);
  assert.throws(() => recordApproval({ runDir: dir, gateId: "PLAN" }), /plan not recorded/);
});
