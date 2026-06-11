import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateAudit } from "../plugins/jam/scripts/lib/audit.mjs";
import { validateState } from "../plugins/jam/scripts/lib/state.mjs";

const yes = () => true;

// A minimal, honest greenfield ledger reaching FINISH: each phase's producing artifact + approval,
// AND a real build sprint (codex-bound + passing evidence + sprint-done) before BUILD->FINISH.
// An honest BUILD always has >=1 done sprint — allSprintsDone rejects empty plans.
function gfLedger() {
  return [
    { type: "intent-sharpened" },
    { type: "grounding-converged" }, { type: "approval", gateId: "GROUND-scope" }, { type: "approval", gateId: "GROUND" }, { type: "phase-advanced", from: "GROUND", to: "CONVERGE" },
    { type: "shortlist-set" }, { type: "convergence-decided" }, { type: "approval", gateId: "CONVERGE-shortlist" }, { type: "approval", gateId: "CONVERGE" }, { type: "phase-advanced", from: "CONVERGE", to: "SPECIFY" },
    { type: "coverage-set" }, { type: "spec-certified", verifyCmd: "exit 1" }, { type: "approval", gateId: "SPECIFY-coverage" }, { type: "approval", gateId: "SPECIFY" }, { type: "phase-advanced", from: "SPECIFY", to: "BUILD" },
    { type: "plan-recorded", sprints: 1, sprintIds: ["b1"] }, { type: "approval", gateId: "BUILD-plan" },
    { type: "sprint-started", sprintId: "b1" },
    { type: "codex-bound", sprintId: "b1" },
    { type: "evidence", sprintId: "b1", gateId: "sprint-b1", exitCode: 0 },
    { type: "sprint-done", sprintId: "b1" },
    { type: "final-verification", command: "exit 1", exitCode: 0 },
    { type: "phase-advanced", from: "BUILD", to: "FINISH" },
  ];
}
// phase:"FINISH" because gfLedger() represents a COMPLETED run (it includes the BUILD->FINISH entry);
// the completeness check (Step 3c) requires expectedFrom === state.phase. The plan has one done sprint
// (b1) with a bound session + transcript so the sprint-honesty checks genuinely pass (not vacuously).
const gfState = () => ({
  mode: "greenfield", phase: "FINISH",
  spec: { certified: true, verifyCmd: "exit 1" },
  plan: { verifyCmd: "exit 1", sprints: [{ id: "b1", status: "done", provenance: "planned", codexSessions: [{ transcriptPath: "/x.jsonl" }] }] },
  promotions: [],
  gates: { "BUILD-plan": { mode: "human", status: "approved" } },
});

test("a full honest greenfield ledger passes the ordering audit", () => {
  const r = evaluateAudit({ ledger: gfLedger(), state: gfState(), transcriptExists: yes });
  assert.deepEqual(r.failures.filter((f) => /ordering/.test(f)), []);
  assert.equal(r.ok, true);
});

test("a greenfield phase advanced without its producing artifact fails the audit", () => {
  const led = gfLedger().filter((e) => e.type !== "spec-certified");   // drop SPECIFY's producer
  const r = evaluateAudit({ ledger: led, state: gfState(), transcriptExists: yes });
  assert.ok(r.failures.some((f) => /ordering: advance from SPECIFY has no valid preceding spec-certified/.test(f)));
});

test("a greenfield run advancing in the wrong order fails", () => {
  const led = [
    { type: "grounding-converged" }, { type: "approval", gateId: "GROUND" },
    { type: "phase-advanced", from: "GROUND", to: "SPECIFY" },   // skipped CONVERGE
  ];
  const r = evaluateAudit({ ledger: led, state: gfState(), transcriptExists: yes });
  assert.ok(r.failures.some((f) => /ordering/.test(f)));
});

test("repair audits are unchanged (a repair ledger still validates by DIAGNOSE order)", () => {
  const led = [
    { type: "digest-rendered", gateId: "DIAGNOSE" }, { type: "approval", gateId: "DIAGNOSE" }, { type: "phase-advanced", from: "DIAGNOSE", to: "VERIFY" },
  ];
  const r = evaluateAudit({ ledger: led, state: { mode: "repair", plan: { sprints: [] } }, transcriptExists: yes });
  assert.deepEqual(r.failures.filter((f) => /expected advance from/.test(f)), []);
});

test("KEY RED-TEAM: BUILD-plan approved (gate) with NO plan-recorded in the ledger fails the audit", () => {
  // a forged greenfield run: BUILD-plan gate approved, but the ledger has no plan-recorded
  const led = gfLedger().filter((e) => e.type !== "plan-recorded");
  const r = evaluateAudit({ ledger: led, state: gfState(), transcriptExists: yes });
  assert.ok(r.failures.some((f) => /greenfield BUILD requires plan-recorded/.test(f)));
});

test("KEY RED-TEAM: a forged greenfield BUILD state with NO BUILD-plan gate fails the audit", () => {
  // sprints could be marked done with valid evidence/authorship, but no human-approved build plan exists.
  // The check is phase-keyed, so simply omitting the gate cannot dodge it.
  const st = gfState();
  delete st.gates["BUILD-plan"];
  const r = evaluateAudit({ ledger: gfLedger(), state: st, transcriptExists: yes });
  assert.ok(r.failures.some((f) => /requires an approved BUILD-plan gate/.test(f)));
});

test("KEY RED-TEAM: a greenfield ledger that advances BUILD->FINISH BEFORE recording the plan fails the audit", () => {
  // plan-recorded + BUILD-plan approval are back-filled AFTER the BUILD->FINISH advance.
  const led = [
    { type: "grounding-converged" }, { type: "approval", gateId: "GROUND-scope" }, { type: "approval", gateId: "GROUND" }, { type: "phase-advanced", from: "GROUND", to: "CONVERGE" },
    { type: "shortlist-set" }, { type: "convergence-decided" }, { type: "approval", gateId: "CONVERGE-shortlist" }, { type: "approval", gateId: "CONVERGE" }, { type: "phase-advanced", from: "CONVERGE", to: "SPECIFY" },
    { type: "coverage-set" }, { type: "spec-certified", verifyCmd: "exit 1" }, { type: "approval", gateId: "SPECIFY-coverage" }, { type: "approval", gateId: "SPECIFY" }, { type: "phase-advanced", from: "SPECIFY", to: "BUILD" },
    { type: "phase-advanced", from: "BUILD", to: "FINISH" },   // advanced BEFORE the plan was recorded
    { type: "plan-recorded" }, { type: "approval", gateId: "BUILD-plan" },
  ];
  const r = evaluateAudit({ ledger: led, state: gfState(), transcriptExists: yes });
  assert.ok(r.failures.some((f) => /BUILD->FINISH advanced without a preceding plan-recorded/.test(f)));
});

test("KEY RED-TEAM: a greenfield FINISH ledger with a sprint NOT done fails the audit", () => {
  // forged: plan-recorded + approval + BUILD->FINISH present, but a planned sprint is still in-progress.
  const st = gfState();
  st.plan.sprints.push({ id: "b2", status: "in-progress", provenance: "planned" });
  const r = evaluateAudit({ ledger: gfLedger(), state: st, transcriptExists: yes });
  assert.ok(r.failures.some((f) => /requires all build sprints done/.test(f)));
});

test("KEY RED-TEAM: a greenfield BUILD run missing the SPECIFY->BUILD advance (skipped phase) fails the audit", () => {
  // honest-looking producers + gates, but the SPECIFY->BUILD phase-advanced entry is absent.
  // The per-advance ordering checks never fire for a missing advance — only the Step 3c
  // complete-prefix check catches it.
  const led = [
    { type: "grounding-converged" }, { type: "approval", gateId: "GROUND-scope" }, { type: "approval", gateId: "GROUND" }, { type: "phase-advanced", from: "GROUND", to: "CONVERGE" },
    { type: "shortlist-set" }, { type: "convergence-decided" }, { type: "approval", gateId: "CONVERGE-shortlist" }, { type: "approval", gateId: "CONVERGE" }, { type: "phase-advanced", from: "CONVERGE", to: "SPECIFY" },
    { type: "coverage-set" }, { type: "spec-certified", verifyCmd: "exit 1" }, { type: "approval", gateId: "SPECIFY-coverage" }, { type: "approval", gateId: "SPECIFY" },   // NO phase-advanced SPECIFY->BUILD
    { type: "plan-recorded" }, { type: "approval", gateId: "BUILD-plan" },
  ];
  const r = evaluateAudit({ ledger: led, state: { ...gfState(), phase: "BUILD" }, transcriptExists: yes });
  assert.ok(r.failures.some((f) => /incomplete|phase was skipped|only advanced to/.test(f)));
});

test("KEY RED-TEAM: a greenfield phase advanced without a required sub-gate approval fails the audit", () => {
  const led = gfLedger().filter((e) => !(e.type === "approval" && e.gateId === "SPECIFY-coverage"));
  const r = evaluateAudit({ ledger: led, state: gfState(), transcriptExists: yes });
  assert.ok(r.failures.some((f) => /required gate SPECIFY-coverage/.test(f)));
});

test("KEY RED-TEAM: a required sub-gate approval after the phase advance does not satisfy the audit", () => {
  const led = gfLedger().filter((e) => !(e.type === "approval" && e.gateId === "SPECIFY-coverage"));
  const specifyAdvance = led.findIndex((e) => e.type === "phase-advanced" && e.from === "SPECIFY" && e.to === "BUILD");
  led.splice(specifyAdvance + 1, 0, { type: "approval", gateId: "SPECIFY-coverage" });
  const r = evaluateAudit({ ledger: led, state: gfState(), transcriptExists: yes });
  assert.ok(r.failures.some((f) => /without a preceding approval for required gate SPECIFY-coverage/.test(f)));
});

test("KEY RED-TEAM: sprint-done with no preceding sprint-started fails the audit", () => {
  const led = gfLedger().filter((e) => e.type !== "sprint-started");
  const r = evaluateAudit({ ledger: led, state: gfState(), transcriptExists: yes });
  assert.ok(r.failures.some((f) => /no preceding sprint-started/.test(f)));
});

test("KEY RED-TEAM: an approved build plan with a missing state sprint fails the audit", () => {
  const led = gfLedger().map((e) => e.type === "plan-recorded" ? { ...e, sprintIds: ["b1", "b2"] } : e);
  const r = evaluateAudit({ ledger: led, state: gfState(), transcriptExists: yes });
  assert.ok(r.failures.some((f) => /approved build sprint b2 is missing/.test(f)));
});

test("KEY RED-TEAM: a build plan re-recorded after BUILD-plan approval fails the audit", () => {
  const led = gfLedger();
  const apprIdx = led.findIndex((e) => e.type === "approval" && e.gateId === "BUILD-plan");
  led.splice(apprIdx + 1, 0, { type: "plan-recorded", sprints: 1, sprintIds: ["forged"] });
  const r = evaluateAudit({ ledger: led, state: gfState(), transcriptExists: yes });
  assert.ok(r.failures.some((f) => /re-recorded after its BUILD-plan approval/.test(f)));
});

test("KEY RED-TEAM: a BUILD sprint started before BUILD-plan approval fails the audit", () => {
  const led = gfLedger().filter((e) => e.type !== "sprint-started");
  const apprIdx = led.findIndex((e) => e.type === "approval" && e.gateId === "BUILD-plan");
  led.splice(apprIdx, 0, { type: "sprint-started", sprintId: "b1" });
  const r = evaluateAudit({ ledger: led, state: gfState(), transcriptExists: yes });
  assert.ok(r.failures.some((f) => /started before the BUILD-plan was approved/.test(f)));
});

test("KEY RED-TEAM: a planned state sprint outside the approved build plan fails the audit", () => {
  const led = gfLedger().filter((e) => !(e.type === "phase-advanced" && e.from === "BUILD" && e.to === "FINISH"));
  const st = { ...gfState(), phase: "BUILD" };
  st.plan.sprints.push({ id: "b2", status: "pending", provenance: "planned" });
  const r = evaluateAudit({ ledger: led, state: st, transcriptExists: yes });
  assert.ok(r.failures.some((f) => /not in the approved build plan/.test(f)));
});

test("KEY RED-TEAM: a greenfield BUILD state with no certified spec.verifyCmd fails validation", () => {
  const st = { ...gfState(), phase: "BUILD", spec: { certified: true } };
  assert.ok(validateState(st).some((e) => /spec\.verifyCmd.*required/.test(e)));
});

test("KEY RED-TEAM: state.spec.verifyCmd must match the certified verifyCmd in the ledger", () => {
  const st = { ...gfState(), spec: { certified: true, verifyCmd: "exit 2" } };
  const r = evaluateAudit({ ledger: gfLedger(), state: st, transcriptExists: yes });
  assert.ok(r.failures.some((f) => /does not match the certified verifyCmd/.test(f)));
});

test("KEY RED-TEAM: a phase outside the greenfield order fails validation and audit", () => {
  const st = {
    runId: "r1",
    mode: "greenfield",
    phase: "NOT_A_PHASE",
    gates: {},
    dial: {},
    createdAt: "t",
  };
  assert.ok(validateState(st).some((e) => /phase NOT_A_PHASE is not a valid phase for mode greenfield/.test(e)));
  const r = evaluateAudit({ ledger: [], state: st, transcriptExists: yes });
  assert.equal(r.ok, false);
  assert.ok(r.failures.some((f) => /phase NOT_A_PHASE is not a valid phase for this mode/.test(f)));
});
