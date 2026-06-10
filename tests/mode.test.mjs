import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { phaseOrderFor, repairPhaseOrder, greenfieldPhaseOrder, GREENFIELD_STUB_PHASES } from "../plugins/jam/scripts/lib/mode.mjs";
import { createRun } from "../plugins/jam/scripts/lib/actions.mjs";
import { readState } from "../plugins/jam/scripts/lib/state.mjs";
import { advanceRun } from "../plugins/jam/scripts/lib/phases.mjs";

function proj() { return fs.mkdtempSync(path.join(os.tmpdir(), "jam-mode-")); }

test("phaseOrderFor selects by mode; repair is the default", () => {
  assert.deepEqual(phaseOrderFor("repair"), repairPhaseOrder);
  assert.deepEqual(phaseOrderFor("greenfield"), greenfieldPhaseOrder);
  assert.deepEqual(phaseOrderFor(undefined), repairPhaseOrder);
  assert.deepEqual(greenfieldPhaseOrder, ["GROUND", "CONVERGE", "SPECIFY", "BUILD", "FINISH"]);
  assert.ok(!GREENFIELD_STUB_PHASES.has("CONVERGE"));
  assert.ok(!GREENFIELD_STUB_PHASES.has("SPECIFY"));
  assert.ok(GREENFIELD_STUB_PHASES.has("BUILD"));
});

test("a greenfield run starts at GROUND with both gates and a grounding block", () => {
  const dir = createRun({ projectRoot: proj(), runId: "r1", mode: "greenfield", now: "t0" });
  const s = readState(dir);
  assert.equal(s.mode, "greenfield");
  assert.equal(s.phase, "GROUND");
  assert.equal(s.gates["GROUND-scope"].approveFrom, "scoped");
  assert.equal(s.gates["GROUND"].approveFrom, "grounded");
  assert.deepEqual(s.grounding, { problem: null, dimensions: [], options: [], claims: [], openUnknowns: [], converged: false });
});

test("a repair run is unchanged (DIAGNOSE, single gate, no grounding)", () => {
  const dir = createRun({ projectRoot: proj(), runId: "r1", mode: "repair", now: "t0" });
  const s = readState(dir);
  assert.equal(s.mode, "repair");
  assert.equal(s.phase, "DIAGNOSE");
  assert.ok(s.gates["DIAGNOSE"]);
  assert.equal(s.grounding, undefined);
});

test("advancing GROUND -> CONVERGE now succeeds (CONVERGE is no longer a stub)", () => {
  const dir = createRun({ projectRoot: proj(), runId: "r1", mode: "greenfield", now: "t0" });
  const s = readState(dir);
  s.gates["GROUND"].status = "approved";
  fs.writeFileSync(path.join(dir, "state.json"), JSON.stringify(s, null, 2));
  advanceRun({ runDir: dir, now: "t1" });
  assert.equal(readState(dir).phase, "CONVERGE");
});
