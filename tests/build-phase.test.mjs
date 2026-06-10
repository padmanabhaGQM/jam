import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readState, validateState } from "../plugins/jam/scripts/lib/state.mjs";
import { createRun, recordApproval } from "../plugins/jam/scripts/lib/actions.mjs";
import { advanceRun } from "../plugins/jam/scripts/lib/phases.mjs";
import { atBuild, atSpecify } from "./helpers/converge.mjs";

test("advancing SPECIFY -> BUILD seeds state.plan from the certified SSOT (locked) + adds BUILD-plan", () => {
  const dir = atBuild(["WER<5%"], "exit 1");
  const s = readState(dir);
  assert.equal(s.phase, "BUILD");
  assert.equal(s.plan.verifyCmd, "exit 1");            // == the certified SSOT
  assert.deepEqual(s.plan.sprints, []);
  assert.equal(s.gates["BUILD-plan"].approveFrom, "planned");
  assert.equal(s.spec.verifyCmd, "exit 1");            // SSOT unchanged
});

test("I2: advancing SPECIFY -> BUILD is refused if the SPECIFY-coverage sub-gate is not approved", () => {
  const dir = atSpecify(["WER<5%"]);
  const s = readState(dir);
  s.gates["SPECIFY"].status = "approved";
  s.spec.certified = true;
  s.spec.verifyCmd = "exit 1";
  // SPECIFY-coverage deliberately left 'pending'
  fs.writeFileSync(path.join(dir, "state.json"), JSON.stringify(s, null, 2));
  assert.throws(() => advanceRun({ runDir: dir, now: "t21" }), /SPECIFY-coverage|awaiting/);
});

test("I2: advancing GROUND is refused if GROUND-scope is not approved (even with GROUND approved)", () => {
  const dir = createRun({ projectRoot: fs.mkdtempSync(path.join(os.tmpdir(), "jam-i2-")), runId: "r1", mode: "greenfield", now: "t0" });
  const s = readState(dir);
  s.gates["GROUND"].status = "approved";   // main gate approved, GROUND-scope still pending
  fs.writeFileSync(path.join(dir, "state.json"), JSON.stringify(s, null, 2));
  assert.throws(() => advanceRun({ runDir: dir, now: "t1" }), /GROUND-scope|awaiting/);
});

test("I2: advancing GROUND is refused if a required sub-gate is missing", () => {
  const dir = createRun({ projectRoot: fs.mkdtempSync(path.join(os.tmpdir(), "jam-i2-")), runId: "r1", mode: "greenfield", now: "t0" });
  const s = readState(dir);
  s.gates["GROUND"].status = "approved";
  delete s.gates["GROUND-scope"];
  fs.writeFileSync(path.join(dir, "state.json"), JSON.stringify(s, null, 2));
  assert.throws(() => advanceRun({ runDir: dir, now: "t1" }), /required gate GROUND-scope is missing/);
});

test("B2: validateState rejects a greenfield BUILD state whose plan.verifyCmd != the certified SSOT", () => {
  const dir = atBuild(["WER<5%"], "exit 1");
  const s = readState(dir);
  assert.equal(validateState(s).length, 0);   // honest: plan.verifyCmd == spec.verifyCmd
  s.plan.verifyCmd = "exit 0";                 // diverge from the SSOT
  assert.ok(validateState(s).some((e) => /plan\.verifyCmd must equal|SSOT/.test(e)));
  const sMissingSpecVerify = readState(dir);
  delete sMissingSpecVerify.spec.verifyCmd;
  assert.ok(validateState(sMissingSpecVerify).some((e) => /spec\.verifyCmd.*required/.test(e)));
  const sMissingPlanVerify = readState(dir);
  delete sMissingPlanVerify.plan.verifyCmd;
  assert.ok(validateState(sMissingPlanVerify).some((e) => /plan\.verifyCmd.*required/.test(e)));
  // also: a greenfield BUILD state with no BUILD-plan gate is rejected at the persistence layer
  const s2 = readState(dir);
  delete s2.gates["BUILD-plan"];
  assert.ok(validateState(s2).some((e) => /BUILD-plan gate is required/.test(e)));
});
