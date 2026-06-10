import { test } from "node:test";
import assert from "node:assert/strict";
import { readState, validateState } from "../plugins/jam/scripts/lib/state.mjs";
import { recordApproval } from "../plugins/jam/scripts/lib/actions.mjs";
import { setCoverage, recordRedProof, recordGameability, certifyVerifyCmd } from "../plugins/jam/scripts/lib/spec.mjs";
import { atSpecify } from "./helpers/converge.mjs";

function covered(dir, verifyCmd) {
  setCoverage({ runDir: dir, verifyCmd, checks: [{ id: "c0", dimension: "WER<5%", ref: "t0" }] });
  recordApproval({ runDir: dir, gateId: "SPECIFY-coverage", who: "u" });
  return dir;
}

test("B1: a verifyCmd that cannot run (command-not-found / exit 127) cannot certify as RED", () => {
  const dir = covered(atSpecify(["WER<5%"]), "this-cmd-does-not-exist-xyz-123");
  recordRedProof({ runDir: dir, cwd: dir });
  recordGameability({ runDir: dir, reviewer: "codex", author: "claude", survivingFindings: 0 });
  assert.throws(() => certifyVerifyCmd({ runDir: dir, cwd: dir }), /did not run|unrunnable|exit 12[67]|exit -/);
});

test("B1: a verifyCmd that RUNS and fails (exit 1) still certifies", () => {
  const dir = covered(atSpecify(["WER<5%"]), "exit 1");
  recordRedProof({ runDir: dir, cwd: dir });
  recordGameability({ runDir: dir, reviewer: "codex", author: "claude", survivingFindings: 0 });
  certifyVerifyCmd({ runDir: dir, cwd: dir });
  assert.equal(readState(dir).gates["SPECIFY"].status, "specified");
});

test("I3: validateState flags SPECIFY approved while spec is missing entirely", () => {
  const dir = atSpecify(["WER<5%"]);
  const s = readState(dir);
  s.gates["SPECIFY"].status = "approved";
  delete s.spec;
  assert.ok(validateState(s).some((e) => /SPECIFY/.test(e) && /spec|certified/.test(e)));
});

test("M5: recordGameability rejects a non-integer survivingFindings", () => {
  const dir = covered(atSpecify(["WER<5%"]), "exit 1");
  assert.throws(() => recordGameability({ runDir: dir, reviewer: "codex", author: "claude", survivingFindings: 0.5 }), /integer|survivingFindings/);
});
