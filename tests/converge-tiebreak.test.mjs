import { test } from "node:test";
import assert from "node:assert/strict";
import { readState } from "../plugins/jam/scripts/lib/state.mjs";
import { readLedger } from "../plugins/jam/scripts/lib/ledger.mjs";
import { recordApproval } from "../plugins/jam/scripts/lib/actions.mjs";
import { setShortlist, recordDecision, ruleTiebreak } from "../plugins/jam/scripts/lib/convergence.mjs";
import { atConverge } from "./helpers/converge.mjs";

function disagreed(dir) {
  setShortlist({ runDir: dir, options: ["opt-A", "opt-B"], now: "t7" });
  recordApproval({ runDir: dir, gateId: "CONVERGE-shortlist", who: "u", now: "t8" });
  recordDecision({ runDir: dir, agent: "claude", chosen: "opt-A", now: "t9" });
  recordDecision({ runDir: dir, agent: "codex", chosen: "opt-B", now: "t10" });
  return dir;
}

test("ruleTiebreak sets the chosen option, approves the tiebreak gate, and ledgers it", () => {
  const dir = disagreed(atConverge());
  ruleTiebreak({ runDir: dir, chosen: "opt-A", now: "t11" });
  const s = readState(dir);
  assert.equal(s.convergence.chosen, "opt-A");
  assert.deepEqual({ chosen: s.convergence.tiebreak.chosen, by: s.convergence.tiebreak.by }, { chosen: "opt-A", by: "user" });
  assert.equal(s.gates["CONVERGE-tiebreak"].status, "approved");
  assert.ok(readLedger(dir).some((e) => e.type === "tiebreak-ruled" && e.chosen === "opt-A"));
});

test("ruleTiebreak refuses with no active disagreement, or chosen off the shortlist", () => {
  const dir = atConverge();
  setShortlist({ runDir: dir, options: ["opt-A", "opt-B"], now: "t7" });
  recordApproval({ runDir: dir, gateId: "CONVERGE-shortlist", who: "u", now: "t8" });
  recordDecision({ runDir: dir, agent: "claude", chosen: "opt-A", now: "t9" });
  recordDecision({ runDir: dir, agent: "codex", chosen: "opt-A", now: "t10" }); // agree → no tiebreak
  assert.throws(() => ruleTiebreak({ runDir: dir, chosen: "opt-A" }), /no active disagreement/);
  const dir2 = disagreed(atConverge());
  assert.throws(() => ruleTiebreak({ runDir: dir2, chosen: "opt-Z" }), /not in the shortlist/);
});
