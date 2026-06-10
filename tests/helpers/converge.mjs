import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRun, recordApproval } from "../../plugins/jam/scripts/lib/actions.mjs";
import { sharpenIntent, addClaim, convergeGrounding } from "../../plugins/jam/scripts/lib/grounding.mjs";
import { advanceRun } from "../../plugins/jam/scripts/lib/phases.mjs";

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
