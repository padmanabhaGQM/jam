import { test } from "node:test";
import assert from "node:assert/strict";
import { readState } from "../plugins/jam/scripts/lib/state.mjs";
import { readLedger } from "../plugins/jam/scripts/lib/ledger.mjs";
import { recordApproval } from "../plugins/jam/scripts/lib/actions.mjs";
import { setCoverage, recordRedProof } from "../plugins/jam/scripts/lib/spec.mjs";
import { atSpecify } from "./helpers/converge.mjs";

function covered(dir, verifyCmd) {
  setCoverage({ runDir: dir, verifyCmd, checks: [{ id: "c1", dimension: "WER<5%", ref: "x" }], now: "t14" });
  recordApproval({ runDir: dir, gateId: "SPECIFY-coverage", who: "u", now: "t15" });
  return dir;
}

test("recordRedProof runs the verifyCmd and records its (non-zero) exit code", () => {
  const dir = covered(atSpecify(["WER<5%"]), "exit 1");
  recordRedProof({ runDir: dir, cwd: dir, now: "t16" });
  const s = readState(dir);
  assert.equal(s.spec.redProof.exitCode, 1);
  assert.ok(readLedger(dir).some((e) => e.type === "redproof-recorded" && e.exitCode === 1));
});

test("recordRedProof records exit 0 too (certify will later reject it)", () => {
  const dir = covered(atSpecify(["WER<5%"]), "exit 0");
  recordRedProof({ runDir: dir, cwd: dir, now: "t16" });
  assert.equal(readState(dir).spec.redProof.exitCode, 0);
});

test("recordRedProof refuses before the SPECIFY-coverage gate is approved", () => {
  const dir = atSpecify(["WER<5%"]);
  setCoverage({ runDir: dir, verifyCmd: "exit 1", checks: [{ id: "c1", dimension: "WER<5%", ref: "x" }], now: "t14" });
  assert.throws(() => recordRedProof({ runDir: dir, cwd: dir }), /coverage .* approved/);
});
