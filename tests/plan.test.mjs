import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRun } from "../plugins/jam/scripts/lib/actions.mjs";
import { addGate, readState, writeState } from "../plugins/jam/scripts/lib/state.mjs";
import { readLedger } from "../plugins/jam/scripts/lib/ledger.mjs";
import { validatePlan, recordPlan, promoteSprint } from "../plugins/jam/scripts/lib/plan.mjs";
import { recordBuildPlan } from "../plugins/jam/scripts/lib/build.mjs";
import { atBuild } from "./helpers/converge.mjs";

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), "jam-plan-")); }
function planObj() {
  return { verifyCmd: "bash verify.sh", sprints: [{ id: "fix-1", title: "wire the gen-time gate", acceptanceCriteria: "no hard failures" }] };
}
function runAtPlan() {
  const root = tmp();
  const dir = createRun({ projectRoot: root, runId: "r1", mode: "repair", now: "t" });
  const s = readState(dir); addGate(s, "PLAN", "human", "planned"); writeState(dir, s);
  return dir;
}
function runAtImplement() {
  const dir = createRun({ projectRoot: tmp(), runId: "r1", mode: "repair", now: "t" });
  const s = readState(dir);
  s.phase = "IMPLEMENT";
  s.plan = { verifyCmd: "true", sprints: [{ id: "fix-1", title: "t", acceptanceCriteria: "ac", status: "pending", provenance: "planned", needs: [] }] };
  writeState(dir, s);
  return dir;
}

test("validatePlan accepts a well-formed plan", () => {
  assert.deepEqual(validatePlan(planObj()), { valid: true, errors: [] });
});

test("validatePlan accepts and recordPlan stores optional finishCmd", () => {
  const dir = runAtPlan();
  const plan = { ...planObj(), finishCmd: "npm run finish" };
  assert.deepEqual(validatePlan(plan), { valid: true, errors: [] });

  recordPlan({ runDir: dir, plan, now: "t1" });
  assert.equal(readState(dir).plan.finishCmd, "npm run finish");
});

test("validatePlan rejects malformed finishCmd when present", () => {
  const empty = validatePlan({ ...planObj(), finishCmd: "" });
  assert.equal(empty.valid, false);
  assert.match(empty.errors.join("; "), /finishCmd, if present, must be a non-empty string/);

  const nonString = validatePlan({ ...planObj(), finishCmd: 123 });
  assert.equal(nonString.valid, false);
  assert.match(nonString.errors.join("; "), /finishCmd, if present, must be a non-empty string/);
});

test("recordPlan leaves absent finishCmd undefined", () => {
  const dir = runAtPlan();
  recordPlan({ runDir: dir, plan: planObj(), now: "t1" });
  assert.equal(readState(dir).plan.finishCmd, undefined);
});

test("validatePlan accepts absent or valid allowedPaths", () => {
  assert.deepEqual(validatePlan(planObj()), { valid: true, errors: [] });
  assert.deepEqual(validatePlan({
    verifyCmd: "bash verify.sh",
    sprints: [{ id: "fix-1", title: "wire the gen-time gate", allowedPaths: ["lib/**"] }]
  }), { valid: true, errors: [] });
});

test("validatePlan rejects malformed allowedPaths", () => {
  const base = { verifyCmd: "bash verify.sh" };
  assert.match(validatePlan({ ...base, sprints: [{ id: "fix-1", title: "t", allowedPaths: [] }] }).errors.join("; "), /allowedPaths must be a non-empty array/);
  assert.match(validatePlan({ ...base, sprints: [{ id: "fix-1", title: "t", allowedPaths: "lib/**" }] }).errors.join("; "), /allowedPaths must be a non-empty array/);
  assert.match(validatePlan({ ...base, sprints: [{ id: "fix-1", title: "t", allowedPaths: [""] }] }).errors.join("; "), /allowedPaths entries must be non-empty strings/);
});

test("validatePlan rejects missing verifyCmd, empty sprints, missing id/title, duplicate ids, non-object", () => {
  assert.equal(validatePlan({ sprints: [{ id: "a", title: "t" }] }).valid, false);
  assert.equal(validatePlan({ verifyCmd: "x", sprints: [] }).valid, false);
  assert.equal(validatePlan({ verifyCmd: "x", sprints: [{ title: "t" }] }).valid, false);
  assert.equal(validatePlan({ verifyCmd: "x", sprints: [{ id: "a", title: "t" }, { id: "a", title: "u" }] }).valid, false);
  assert.equal(validatePlan(null).valid, false);
});

test("recordPlan records a valid plan and flips PLAN gate to 'planned'", () => {
  const dir = runAtPlan();
  recordPlan({ runDir: dir, plan: planObj(), now: "t1" });
  const s = readState(dir);
  assert.equal(s.gates.PLAN.status, "planned");
  assert.equal(s.plan.verifyCmd, "bash verify.sh");
  assert.equal(s.plan.sprints[0].id, "fix-1");
  assert.equal(s.plan.sprints[0].status, "pending");
  assert.equal(s.plan.sprints[0].provenance, "planned");
  assert.ok(fs.existsSync(path.join(dir, "plan.json")));
  assert.equal(readLedger(dir).at(-1).type, "plan-recorded");
});

test("recordPlan preserves sprint allowedPaths in state", () => {
  const dir = runAtPlan();
  recordPlan({
    runDir: dir,
    plan: {
      verifyCmd: "bash verify.sh",
      sprints: [{ id: "fix-1", title: "wire the gen-time gate", allowedPaths: ["lib/**"] }]
    },
    now: "t1"
  });
  assert.deepEqual(readState(dir).plan.sprints[0].allowedPaths, ["lib/**"]);
});

test("recordBuildPlan preserves sprint allowedPaths in state", () => {
  const dir = atBuild(["WER<5%"], "exit 1");
  recordBuildPlan({ runDir: dir, sprints: [{ id: "b1", title: "scaffold", allowedPaths: ["src/**"] }], now: "t21" });
  assert.deepEqual(readState(dir).plan.sprints[0].allowedPaths, ["src/**"]);
});

test("promoteSprint preserves sprint allowedPaths in state", () => {
  const dir = runAtImplement();
  promoteSprint({ runDir: dir, id: "fix-9", title: "discovered", reason: "found during fix-1", allowedPaths: ["tests/**"], now: "t1" });
  assert.deepEqual(readState(dir).plan.sprints.find((s) => s.id === "fix-9").allowedPaths, ["tests/**"]);
});

test("recordPlan throws on an invalid plan", () => {
  const dir = runAtPlan();
  assert.throws(() => recordPlan({ runDir: dir, plan: { sprints: [] } }), /invalid plan/);
});

test("recordPlan throws when there is no PLAN gate", () => {
  const root = tmp();
  const dir = createRun({ projectRoot: root, runId: "r1", mode: "repair", now: "t" });
  assert.throws(() => recordPlan({ runDir: dir, plan: planObj() }), /not in PLAN phase/);
});

test("recordPlan throws if the PLAN gate is not plan-bound", () => {
  const root = tmp();
  const dir = createRun({ projectRoot: root, runId: "r1", mode: "repair", now: "t" });
  const s = readState(dir); addGate(s, "PLAN", "human", "rendered"); writeState(dir, s);
  assert.throws(() => recordPlan({ runDir: dir, plan: planObj() }), /not a plan gate/);
});

test("recordPlan refuses to re-record after the PLAN gate is approved", () => {
  const dir = runAtPlan();
  recordPlan({ runDir: dir, plan: planObj(), now: "t1" });
  const s = readState(dir); s.gates.PLAN.status = "approved"; writeState(dir, s);
  assert.throws(() => recordPlan({ runDir: dir, plan: planObj(), now: "t2" }), /already approved/);
});
