import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRun } from "../plugins/jam/scripts/lib/actions.mjs";
import { addGate, readState, writeState } from "../plugins/jam/scripts/lib/state.mjs";
import { readLedger } from "../plugins/jam/scripts/lib/ledger.mjs";
import { validatePlan, recordPlan } from "../plugins/jam/scripts/lib/plan.mjs";

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

test("validatePlan accepts a well-formed plan", () => {
  assert.deepEqual(validatePlan(planObj()), { valid: true, errors: [] });
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
  assert.ok(fs.existsSync(path.join(dir, "plan.json")));
  assert.equal(readLedger(dir).at(-1).type, "plan-recorded");
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
