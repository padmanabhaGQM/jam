import { test } from "node:test";
import assert from "node:assert/strict";
import { readState } from "../plugins/jam/scripts/lib/state.mjs";
import { readLedger } from "../plugins/jam/scripts/lib/ledger.mjs";
import { recordApproval } from "../plugins/jam/scripts/lib/actions.mjs";
import { setShortlist, recordDecision } from "../plugins/jam/scripts/lib/convergence.mjs";
import { atConverge } from "./helpers/converge.mjs";

function shortlisted(dir) {
  setShortlist({ runDir: dir, options: ["opt-A", "opt-B"], now: "t7" });
  recordApproval({ runDir: dir, gateId: "CONVERGE-shortlist", who: "u", now: "t8" });
  return dir;
}

test("recordDecision needs the shortlist approved and a chosen in the shortlist", () => {
  const dir = atConverge();
  assert.throws(() => recordDecision({ runDir: dir, agent: "claude", chosen: "opt-A" }), /shortlist .* approved/);
  shortlisted(dir);
  assert.throws(() => recordDecision({ runDir: dir, agent: "claude", chosen: "opt-Z" }), /not in the approved shortlist/);
  assert.throws(() => recordDecision({ runDir: dir, agent: "nobody", chosen: "opt-A" }), /agent/);
});

test("agree path: both pick the same option -> agree=true, chosen set, NO tiebreak gate", () => {
  const dir = shortlisted(atConverge());
  recordDecision({ runDir: dir, agent: "claude", chosen: "opt-A", rationale: "best", now: "t9" });
  recordDecision({ runDir: dir, agent: "codex", chosen: "opt-A", rationale: "agreed", spikes: ["s1"], now: "t10" });
  const s = readState(dir);
  assert.equal(s.convergence.agree, true);
  assert.equal(s.convergence.chosen, "opt-A");
  assert.equal(s.gates["CONVERGE-tiebreak"], undefined);
  assert.equal(readLedger(dir).filter((e) => e.type === "decision-recorded").length, 2);
});

test("disagree path: different options -> agree=false, chosen null, CONVERGE-tiebreak gate created (contested)", () => {
  const dir = shortlisted(atConverge());
  recordDecision({ runDir: dir, agent: "claude", chosen: "opt-A", now: "t9" });
  recordDecision({ runDir: dir, agent: "codex", chosen: "opt-B", now: "t10" });
  const s = readState(dir);
  assert.equal(s.convergence.agree, false);
  assert.equal(s.convergence.chosen, null);
  assert.equal(s.gates["CONVERGE-tiebreak"].approveFrom, "contested");
  assert.equal(s.gates["CONVERGE-tiebreak"].status, "contested");
});

test("a fresh AGREEMENT after a disagreement dissolves the stale tiebreak gate", () => {
  const dir = shortlisted(atConverge());
  recordDecision({ runDir: dir, agent: "claude", chosen: "opt-A", now: "t9" });
  recordDecision({ runDir: dir, agent: "codex", chosen: "opt-B", now: "t10" });
  assert.ok(readState(dir).gates["CONVERGE-tiebreak"]);
  recordDecision({ runDir: dir, agent: "codex", chosen: "opt-A", now: "t11" });
  const s = readState(dir);
  assert.equal(s.convergence.agree, true);
  assert.equal(s.convergence.chosen, "opt-A");
  assert.equal(s.gates["CONVERGE-tiebreak"], undefined);
});
