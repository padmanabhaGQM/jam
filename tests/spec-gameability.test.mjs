import { test } from "node:test";
import assert from "node:assert/strict";
import { readState } from "../plugins/jam/scripts/lib/state.mjs";
import { readLedger } from "../plugins/jam/scripts/lib/ledger.mjs";
import { recordApproval } from "../plugins/jam/scripts/lib/actions.mjs";
import { setCoverage, recordGameability } from "../plugins/jam/scripts/lib/spec.mjs";
import { atSpecify } from "./helpers/converge.mjs";

function covered(dir) {
  setCoverage({ runDir: dir, verifyCmd: "exit 1", checks: [{ id: "c1", dimension: "WER<5%", ref: "x" }], now: "t14" });
  recordApproval({ runDir: dir, gateId: "SPECIFY-coverage", who: "u", now: "t15" });
  return dir;
}

test("recordGameability stores a Codex verdict with a surviving-findings count", () => {
  const dir = covered(atSpecify(["WER<5%"]));
  recordGameability({ runDir: dir, reviewer: "codex", author: "claude", survivingFindings: 0, findings: [], now: "t16" });
  const s = readState(dir);
  assert.equal(s.spec.gameability.reviewer, "codex");
  assert.equal(s.spec.gameability.survivingFindings, 0);
  assert.ok(readLedger(dir).some((e) => e.type === "gameability-verdict"));
});

test("recordGameability refuses a non-Codex reviewer or reviewer===author (anti-collusion)", () => {
  const dir = covered(atSpecify(["WER<5%"]));
  assert.throws(() => recordGameability({ runDir: dir, reviewer: "claude", author: "claude", survivingFindings: 0 }), /codex/);
  assert.throws(() => recordGameability({ runDir: dir, reviewer: "codex", author: "codex", survivingFindings: 0 }), /differ from author|anti-collusion/);
  assert.throws(() => recordGameability({ runDir: dir, reviewer: "codex", author: "claude" }), /survivingFindings/);
});
