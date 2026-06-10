import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { readState, validateState } from "../plugins/jam/scripts/lib/state.mjs";
import { readLedger } from "../plugins/jam/scripts/lib/ledger.mjs";
import { recordApproval } from "../plugins/jam/scripts/lib/actions.mjs";
import { advanceRun } from "../plugins/jam/scripts/lib/phases.mjs";
import { setCoverage, recordRedProof, recordGameability, certifyVerifyCmd } from "../plugins/jam/scripts/lib/spec.mjs";
import { atSpecify } from "./helpers/converge.mjs";

// Drive to a covered+red+audited state for the given dims; returns dir. verifyCmd default "exit 1" (red).
function ready(dims, verifyCmd = "exit 1", surviving = 0) {
  const dir = atSpecify(dims);
  setCoverage({ runDir: dir, verifyCmd, checks: dims.map((d, i) => ({ id: `c${i}`, dimension: d, ref: `t${i}` })), now: "t14" });
  recordApproval({ runDir: dir, gateId: "SPECIFY-coverage", who: "u", now: "t15" });
  recordRedProof({ runDir: dir, cwd: dir, now: "t16" });
  recordGameability({ runDir: dir, reviewer: "codex", author: "claude", survivingFindings: surviving, findings: [], now: "t17" });
  return dir;
}

test("certifyVerifyCmd flips SPECIFY to 'specified' on a clean spec; then human can ratify", () => {
  const dir = ready(["WER<5%"]);
  certifyVerifyCmd({ runDir: dir, cwd: dir, now: "t18" });
  const s = readState(dir);
  assert.equal(s.spec.certified, true);
  assert.equal(s.gates["SPECIFY"].status, "specified");
  assert.ok(readLedger(dir).some((e) => e.type === "spec-certified"));
  recordApproval({ runDir: dir, gateId: "SPECIFY", who: "u", now: "t19" });
  assert.equal(readState(dir).gates["SPECIFY"].status, "approved");
});

test("KEY RED-TEAM: a verifyCmd that already PASSES (red-first exit 0) cannot be certified", () => {
  const dir = ready(["WER<5%"], "exit 0");
  assert.throws(() => certifyVerifyCmd({ runDir: dir, cwd: dir }), /already passes|must be RED/);
  assert.notEqual(readState(dir).gates["SPECIFY"].status, "specified");
});

test("KEY RED-TEAM: surviving gameability findings block certification", () => {
  const dir = ready(["WER<5%"], "exit 1", 2);
  assert.throws(() => certifyVerifyCmd({ runDir: dir, cwd: dir }), /surviving gameability/);
});

test("KEY RED-TEAM (defense): certify refuses a forged ledger dimension that has no check", () => {
  const dir = ready(["WER<5%"]);
  const s = readState(dir);
  s.convergence.ledger.push({ dimension: "latency", status: "at-risk", accepted: true });  // smuggled dim, no check
  fs.writeFileSync(path.join(dir, "state.json"), JSON.stringify(s, null, 2));
  assert.throws(() => certifyVerifyCmd({ runDir: dir, cwd: dir }), /latency.*no check/);
});

test("KEY RED-TEAM: recording a new red-proof AFTER certify re-arms SPECIFY (no stale proof mutation)", () => {
  const dir = ready(["WER<5%"]);
  certifyVerifyCmd({ runDir: dir, cwd: dir, now: "t18" });
  assert.equal(readState(dir).gates["SPECIFY"].status, "specified");
  recordRedProof({ runDir: dir, cwd: dir, now: "t19" });
  const s = readState(dir);
  assert.equal(s.gates["SPECIFY"].status, "pending");
  assert.equal(s.spec.certified, false);
});

test("KEY RED-TEAM: certification is refused when the converged decision has zero acceptance dimensions", () => {
  const dir = ready(["WER<5%"]);
  const s = readState(dir);
  s.convergence.ledger = [];
  fs.writeFileSync(path.join(dir, "state.json"), JSON.stringify(s, null, 2));
  assert.throws(() => certifyVerifyCmd({ runDir: dir, cwd: dir }), /no acceptance dimensions/);
});

test("approving SPECIFY/SPECIFY-coverage early gives an honest message (not 'digest not rendered')", () => {
  const dir = atSpecify(["WER<5%"]);
  assert.throws(() => recordApproval({ runDir: dir, gateId: "SPECIFY-coverage", who: "u" }), /coverage|jam specify coverage/);
  setCoverage({ runDir: dir, verifyCmd: "exit 1", checks: [{ id: "c0", dimension: "WER<5%", ref: "t0" }] });
  recordApproval({ runDir: dir, gateId: "SPECIFY-coverage", who: "u" });
  assert.throws(() => recordApproval({ runDir: dir, gateId: "SPECIFY", who: "u" }), /certif|jam specify certify/);
});

test("certify refuses before red-proof or gameability are recorded", () => {
  const dir = atSpecify(["WER<5%"]);
  setCoverage({ runDir: dir, verifyCmd: "exit 1", checks: [{ id: "c0", dimension: "WER<5%", ref: "t0" }], now: "t14" });
  recordApproval({ runDir: dir, gateId: "SPECIFY-coverage", who: "u", now: "t15" });
  assert.throws(() => certifyVerifyCmd({ runDir: dir, cwd: dir }), /red-first proof/);
  recordRedProof({ runDir: dir, cwd: dir, now: "t16" });
  assert.throws(() => certifyVerifyCmd({ runDir: dir, cwd: dir }), /gameability verdict/);
});

test("KEY RED-TEAM: re-arm — editing the suite after certify resets SPECIFY to pending and clears proofs", () => {
  const dir = ready(["WER<5%"]);
  certifyVerifyCmd({ runDir: dir, cwd: dir, now: "t18" });
  assert.equal(readState(dir).gates["SPECIFY"].status, "specified");
  setCoverage({ runDir: dir, verifyCmd: "exit 7", checks: [{ id: "c0", dimension: "WER<5%", ref: "t0" }], now: "t19" });
  const s = readState(dir);
  assert.equal(s.gates["SPECIFY"].status, "pending");
  assert.equal(s.spec.certified, false);
  assert.equal(s.spec.redProof, null);
  assert.equal(s.spec.gameability, null);
});

test("after certify+approval, advancing hits the BUILD stub", () => {
  const dir = ready(["WER<5%"]);
  certifyVerifyCmd({ runDir: dir, cwd: dir, now: "t18" });
  recordApproval({ runDir: dir, gateId: "SPECIFY", who: "u", now: "t19" });
  assert.throws(() => advanceRun({ runDir: dir, now: "t20" }), /BUILD is not yet implemented \(ships in ganjam G4\)/);
});

test("validateState rejects a SPECIFY gate specified/approved while spec.certified is false", () => {
  const dir = ready(["WER<5%"]);
  const s = readState(dir);
  s.gates["SPECIFY"].status = "specified";
  s.spec.certified = false;
  assert.ok(validateState(s).some((e) => /certified/.test(e)));
});
