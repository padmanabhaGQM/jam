import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRun, recordApproval } from "../../plugins/jam/scripts/lib/actions.mjs";
import { sharpenIntent, addClaim, convergeGrounding } from "../../plugins/jam/scripts/lib/grounding.mjs";
import { advanceRun } from "../../plugins/jam/scripts/lib/phases.mjs";
import { setShortlist, recordDecision, convergeDecision } from "../../plugins/jam/scripts/lib/convergence.mjs";

// Drive a fresh greenfield run through GROUND to the CONVERGE phase, with given
// acceptance dimensions and (optional) carried-forward open-unknowns.
export function atConverge(dims = ["WER<5%", "speaker-preserved"], openUnknowns = []) {
  const dir = createRun({ projectRoot: fs.mkdtempSync(path.join(os.tmpdir(), "jam-cvg-")), runId: "r1", mode: "greenfield", now: "t0" });
  sharpenIntent({ runDir: dir, problem: "p", dimensions: dims, now: "t1" });
  recordApproval({ runDir: dir, gateId: "GROUND-scope", who: "u", now: "t2" });
  addClaim({ runDir: dir, id: "c1", text: "x", kind: "framing", status: "evidenced", source: "both", now: "t3" });
  convergeGrounding({ runDir: dir, openUnknowns, now: "t4" });
  recordApproval({ runDir: dir, gateId: "GROUND", who: "u", now: "t5" });
  advanceRun({ runDir: dir, now: "t6" });
  return dir;
}

// Drive a greenfield run all the way to the SPECIFY phase (CONVERGE decided + approved + advanced).
// Uses at-risk+accepted ledger rows so no spike transcripts are needed.
export function atSpecify(dims = ["WER<5%", "speaker-preserved"]) {
  const dir = atConverge(dims);
  setShortlist({ runDir: dir, options: ["opt-A"], now: "t7" });
  recordApproval({ runDir: dir, gateId: "CONVERGE-shortlist", who: "u", now: "t8" });
  recordDecision({ runDir: dir, agent: "claude", chosen: "opt-A", now: "t9" });
  recordDecision({ runDir: dir, agent: "codex", chosen: "opt-A", now: "t10" });
  convergeDecision({ runDir: dir, ledger: dims.map((d) => ({ dimension: d, status: "at-risk", rationale: "x", accepted: true })), spikes: [], now: "t11" });
  recordApproval({ runDir: dir, gateId: "CONVERGE", who: "u", now: "t12" });
  advanceRun({ runDir: dir, now: "t13" });   // CONVERGE -> SPECIFY
  return dir;
}
