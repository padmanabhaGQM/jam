import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { readState } from "../plugins/jam/scripts/lib/state.mjs";
import { readLedger } from "../plugins/jam/scripts/lib/ledger.mjs";
import { recordApproval } from "../plugins/jam/scripts/lib/actions.mjs";
import { recordBuildPlan } from "../plugins/jam/scripts/lib/build.mjs";
import { atBuild } from "./helpers/converge.mjs";

test("recordBuildPlan sets sprints, keeps verifyCmd = the locked SSOT, opens BUILD-plan", () => {
  const dir = atBuild(["WER<5%"], "exit 1");
  recordBuildPlan({ runDir: dir, sprints: [{ id: "b1", title: "scaffold", needs: [] }, { id: "b2", title: "impl", needs: ["b1"] }], now: "t21" });
  const s = readState(dir);
  assert.equal(s.plan.verifyCmd, "exit 1");
  assert.equal(s.plan.sprints.length, 2);
  assert.equal(s.plan.sprints[0].provenance, "planned");
  assert.equal(s.gates["BUILD-plan"].status, "planned");
  assert.ok(readLedger(dir).some((e) => e.type === "plan-recorded"));
  recordApproval({ runDir: dir, gateId: "BUILD-plan", who: "u", now: "t22" });
  assert.equal(readState(dir).gates["BUILD-plan"].status, "approved");
});

test("KEY RED-TEAM: recordBuildPlan rejects a verifyCmd that differs from the certified SSOT", () => {
  const dir = atBuild(["WER<5%"], "exit 1");
  assert.throws(() => recordBuildPlan({ runDir: dir, sprints: [{ id: "b1", title: "x" }], verifyCmd: "exit 0" }), /locked to the certified SSOT|verifyCmd/);
  assert.equal(readState(dir).plan.verifyCmd, "exit 1");
});

test("recordBuildPlan rejects an invalid sprint DAG", () => {
  const dir = atBuild(["WER<5%"], "exit 1");
  assert.throws(() => recordBuildPlan({ runDir: dir, sprints: [{ id: "b1", title: "x", needs: ["nope"] }] }), /needs|dangling|graph|nope/);
});

test("recordBuildPlan rejects duplicate sprint ids and missing titles (full schema)", () => {
  const dir = atBuild(["WER<5%"], "exit 1");
  assert.throws(() => recordBuildPlan({ runDir: dir, sprints: [{ id: "b1", title: "x" }, { id: "b1", title: "y" }] }), /duplicate/);
  assert.throws(() => recordBuildPlan({ runDir: dir, sprints: [{ id: "b2" }] }), /title/);
});

test("recordBuildPlan refuses outside the BUILD phase", () => {
  const dir = atBuild(["WER<5%"], "exit 1");
  const s = readState(dir); s.phase = "SPECIFY";
  fs.writeFileSync(path.join(dir, "state.json"), JSON.stringify(s, null, 2));
  assert.throws(() => recordBuildPlan({ runDir: dir, sprints: [{ id: "b1", title: "x" }] }), /BUILD phase/);
});
