import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { readState } from "../plugins/jam/scripts/lib/state.mjs";
import { advanceRun } from "../plugins/jam/scripts/lib/phases.mjs";
import { setShortlist } from "../plugins/jam/scripts/lib/convergence.mjs";
import { atSpecify } from "./helpers/converge.mjs";

test("advancing CONVERGE -> SPECIFY now succeeds, creates the SPECIFY gates and spec block", () => {
  const dir = atSpecify();
  const s = readState(dir);
  assert.equal(s.phase, "SPECIFY");
  assert.equal(s.gates["SPECIFY-coverage"].approveFrom, "covered");
  assert.equal(s.gates["SPECIFY"].approveFrom, "specified");
  assert.deepEqual(s.spec, { verifyCmd: null, checks: [], redProof: null, gameability: null, certified: false });
});

test("BUILD is still a stub: advancing from SPECIFY refuses once SPECIFY is (forcibly) approved", () => {
  const dir = atSpecify();
  const s = readState(dir);
  s.gates["SPECIFY"].status = "approved";
  s.spec.certified = true;
  fs.writeFileSync(path.join(dir, "state.json"), JSON.stringify(s, null, 2));
  assert.throws(() => advanceRun({ runDir: dir, now: "t14" }), /BUILD is not yet implemented \(ships in ganjam G4\)/);
});

test("G2 convergence is FROZEN once the run is in SPECIFY", () => {
  const dir = atSpecify(["WER<5%"]);
  assert.throws(() => setShortlist({ runDir: dir, options: ["opt-Z"] }), /CONVERGE phase|phase=SPECIFY/);
});
