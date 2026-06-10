import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { readState } from "../plugins/jam/scripts/lib/state.mjs";
import { advanceRun } from "../plugins/jam/scripts/lib/phases.mjs";
import { sharpenIntent, addClaim } from "../plugins/jam/scripts/lib/grounding.mjs";
import { atConverge } from "./helpers/converge.mjs";

test("advancing GROUND -> CONVERGE now succeeds, creates the CONVERGE gates and convergence block", () => {
  const dir = atConverge();
  const s = readState(dir);
  assert.equal(s.phase, "CONVERGE");
  assert.equal(s.gates["CONVERGE-shortlist"].approveFrom, "shortlisted");
  assert.equal(s.gates["CONVERGE"].approveFrom, "decided");
  assert.equal(s.gates["CONVERGE-tiebreak"], undefined);
  assert.deepEqual(s.convergence, { shortlist: [], decisions: {}, agree: null, tiebreak: null, chosen: null, ledger: [], spikes: [], acceptedUnknowns: [], decided: false });
  assert.deepEqual(s.grounding.dimensions, ["WER<5%", "speaker-preserved"]);
});

test("KEY RED-TEAM: G1 grounding is FROZEN after advancing to CONVERGE (no late dimension can stale a decision)", () => {
  const dir = atConverge(["WER<5%"]);
  assert.throws(() => sharpenIntent({ runDir: dir, problem: "p2", dimensions: ["sneaky-new-dim"] }), /frozen after the GROUND phase|phase=CONVERGE/);
  assert.throws(() => addClaim({ runDir: dir, id: "c2", text: "x", kind: "framing", status: "evidenced", source: "both" }), /frozen|phase=CONVERGE/);
  assert.deepEqual(readState(dir).grounding.dimensions, ["WER<5%"]);  // unchanged
});

test("advancing CONVERGE -> SPECIFY now succeeds (SPECIFY is no longer a stub)", () => {
  const dir = atConverge();
  const s = readState(dir);
  s.gates["CONVERGE"].status = "approved";
  s.gates["CONVERGE-shortlist"].status = "approved";
  s.convergence.decided = true;
  fs.writeFileSync(path.join(dir, "state.json"), JSON.stringify(s, null, 2));
  advanceRun({ runDir: dir, now: "t7" });
  assert.equal(readState(dir).phase, "SPECIFY");
});
