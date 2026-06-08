import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRun, recordApproval } from "../plugins/jam/scripts/lib/actions.mjs";
import { addGate, readState, writeState } from "../plugins/jam/scripts/lib/state.mjs";
import { recordVerification } from "../plugins/jam/scripts/lib/control.mjs";
import { readLedger } from "../plugins/jam/scripts/lib/ledger.mjs";

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), "jam-ver-")); }
function addVerifyGate(dir) {
  const s = readState(dir); addGate(s, "VERIFY", "human"); writeState(dir, s); return dir;
}

test("clean verdict (no blockers) sets gate to verified; then it is approvable", () => {
  const root = tmp();
  const dir = createRun({ projectRoot: root, runId: "r1", mode: "repair", now: "t" });
  addVerifyGate(dir);
  recordVerification({ runDir: dir, gateId: "VERIFY", verdict: { unresolvedBlockers: 0, findings: [] }, now: "t1" });
  assert.equal(readState(dir).gates.VERIFY.status, "verified");
  recordApproval({ runDir: dir, gateId: "VERIFY", who: "neel", now: "t2" });
  assert.equal(readState(dir).gates.VERIFY.status, "approved");
  assert.equal(readLedger(dir).some(e => e.type === "verification"), true);
});

test("verdict with surviving blockers does NOT verify the gate", () => {
  const root = tmp();
  const dir = createRun({ projectRoot: root, runId: "r1", mode: "repair", now: "t" });
  addVerifyGate(dir);
  recordVerification({ runDir: dir, gateId: "VERIFY", verdict: { unresolvedBlockers: 2 }, now: "t1" });
  assert.equal(readState(dir).gates.VERIFY.status, "pending");
});

test("blocker count derives from findings when unresolvedBlockers absent", () => {
  const root = tmp();
  const dir = createRun({ projectRoot: root, runId: "r1", mode: "repair", now: "t" });
  addVerifyGate(dir);
  recordVerification({ runDir: dir, gateId: "VERIFY", verdict: { findings: [{ severity: "blocker", description: "x" }] }, now: "t1" });
  assert.equal(readState(dir).gates.VERIFY.status, "pending");
});

test("a human DIAGNOSE gate still throws on approve-before-render (regression)", () => {
  const root = tmp();
  const dir = createRun({ projectRoot: root, runId: "r1", mode: "repair", now: "t" });
  assert.throws(() => recordApproval({ runDir: dir, gateId: "DIAGNOSE", now: "t1" }), /digest not rendered/);
});
