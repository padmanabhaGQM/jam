import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { readState } from "../plugins/jam/scripts/lib/state.mjs";
import { readLedger } from "../plugins/jam/scripts/lib/ledger.mjs";
import { recordApproval } from "../plugins/jam/scripts/lib/actions.mjs";
import { setCoverage } from "../plugins/jam/scripts/lib/spec.mjs";
import { atSpecify } from "./helpers/converge.mjs";

test("setCoverage records verifyCmd + checks and flips SPECIFY-coverage to covered", () => {
  const dir = atSpecify(["WER<5%"]);
  setCoverage({ runDir: dir, verifyCmd: "bash verify.sh", checks: [{ id: "c1", dimension: "WER<5%", ref: "tests/test_wer.py" }], now: "t14" });
  const s = readState(dir);
  assert.equal(s.spec.verifyCmd, "bash verify.sh");
  assert.equal(s.spec.checks.length, 1);
  assert.equal(s.gates["SPECIFY-coverage"].status, "covered");
  assert.ok(readLedger(dir).some((e) => e.type === "coverage-set"));
  recordApproval({ runDir: dir, gateId: "SPECIFY-coverage", who: "u", now: "t15" });
  assert.equal(readState(dir).gates["SPECIFY-coverage"].status, "approved");
});

test("setCoverage rejects empty verifyCmd, empty checks, and malformed checks", () => {
  const dir = atSpecify(["WER<5%"]);
  assert.throws(() => setCoverage({ runDir: dir, verifyCmd: "", checks: [{ id: "c1", dimension: "WER<5%", ref: "x" }] }), /verifyCmd/);
  assert.throws(() => setCoverage({ runDir: dir, verifyCmd: "x", checks: [] }), /at least one check/);
  assert.throws(() => setCoverage({ runDir: dir, verifyCmd: "x", checks: [{ id: "c1", dimension: "WER<5%" }] }), /id, dimension, and ref/);
});

test("setCoverage refuses outside the SPECIFY phase", () => {
  const dir = atSpecify(["WER<5%"]);
  const sp = path.join(dir, "state.json");
  const s = JSON.parse(fs.readFileSync(sp, "utf8"));
  s.phase = "CONVERGE";
  fs.writeFileSync(sp, JSON.stringify(s, null, 2));
  assert.throws(() => setCoverage({ runDir: dir, verifyCmd: "x", checks: [{ id: "c1", dimension: "WER<5%", ref: "x" }] }), /SPECIFY phase/);
});

test("setCoverage enforces gate-1 coverage: every G2 dimension must have a check", () => {
  const dir = atSpecify(["WER<5%", "latency"]);
  assert.throws(() => setCoverage({ runDir: dir, verifyCmd: "exit 1", checks: [{ id: "c0", dimension: "WER<5%", ref: "t0" }] }), /latency.*no check/);
});
