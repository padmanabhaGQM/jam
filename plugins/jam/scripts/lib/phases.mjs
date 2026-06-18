import path from "node:path";
import { readState, writeState, addGate } from "./state.mjs";
import { evaluateGate } from "./gate.mjs";
import { appendLedger } from "./ledger.mjs";
import { allSprintsDone } from "./sprint.mjs";
import { auditRun } from "./audit.mjs";
import { runVerification } from "./evidence.mjs";
import { phaseOrderFor, REQUIRED_GREENFIELD_GATES } from "./mode.mjs";

export { repairPhaseOrder } from "./mode.mjs";

export function nextSprintHint(state) {
  const sprints = state.plan?.sprints ?? [];
  if (sprints.length === 0) return "jam build plan --file <plan.json>";
  const open = sprints.find((sp) => sp.status === "in-progress" && sp.turn && sp.turn.status === "open" && sp.turn.isolated !== false);
  if (open) return `jam reconcile --sprint ${open.id}`;
  const inProgress = sprints.find((sp) => sp.status === "in-progress");
  if (inProgress) {
    const g = state.gates?.[`sprint-${inProgress.id}`];
    return g && g.status === "evidence-passed"
      ? `jam sprint ${inProgress.id} --done`
      : `jam sprint ${inProgress.id} --verify`;
  }
  const done = new Set(sprints.filter((sp) => sp.status === "done").map((sp) => sp.id));
  const pending = sprints.find((sp) => sp.status === "pending" && (sp.needs ?? []).every((need) => done.has(need)));
  return pending ? `jam sprint ${pending.id} --start` : null;
}

function notAllSprintsDoneMessage(state) {
  const hint = nextSprintHint(state);
  return `cannot advance from ${state.phase}: not all sprints done${hint ? ` — next: ${hint}` : ""}`;
}

export function advancePhase(state, { verified = false } = {}) {
  const order = phaseOrderFor(state.mode);
  const i = order.indexOf(state.phase);
  if (i === -1) throw new Error(`advancePhase: ${state.phase} is not a phase in mode ${state.mode ?? "repair"}`);
  const next = order[i + 1];
  if (!next) throw new Error(state.mode === "greenfield" ? `already at the final phase (${state.phase})` : `already at the final repair phase (${state.phase})`);
  const openRejection = Object.entries(state.gates ?? {}).find(([gid, g]) => {
    if (g.status !== "rejected") return false;
    if (gid.startsWith("action-")) {
      const act = (state.actions ?? []).find((a) => a.id === gid.slice("action-".length));
      if (act && act.status === "denied") return false;
    }
    return true;
  });
  if (openRejection) throw new Error(`cannot advance: gate ${openRejection[0]} is rejected (${openRejection[1].rejectedReason ?? "no reason"}) — re-produce its artifact (rewind first if it belongs to an earlier phase) and resolve it`);
  // The FINISH transition requires the live verifyCmd re-verification that only advanceRun performs
  // (it has the run dir / project root). Refuse it here so the exported advancePhase cannot be used as a
  // public-lib bypass that persists FINISH without re-verifying the current workspace.
  if (next === "FINISH" && !verified) {
    throw new Error("advancePhase: the FINISH transition requires live verifyCmd re-verification — call advanceRun, not advancePhase");
  }
  if (state.phase === "IMPLEMENT" || (state.mode === "greenfield" && state.phase === "BUILD")) {
    if (!allSprintsDone(state)) throw new Error(notAllSprintsDoneMessage(state));
  }
  if (state.mode === "greenfield") {
    for (const id of (REQUIRED_GREENFIELD_GATES[state.phase] ?? [])) {
      if (!state.gates[id]) throw new Error(`cannot advance from ${state.phase}: required gate ${id} is missing`);
    }
    // I2: every gate of the current phase (main + sub-gates) must be approved before advancing
    for (const id of Object.keys(state.gates)) {
      if (id === state.phase || id.startsWith(state.phase + "-")) {
        const { allowed, reason } = evaluateGate(state, id);
        if (!allowed) throw new Error(`cannot advance from ${state.phase}: ${reason}`);
      }
    }
  } else if (state.phase !== "IMPLEMENT") {
    const { allowed, reason } = evaluateGate(state, state.phase);
    if (!allowed) throw new Error(`cannot advance from ${state.phase}: ${reason}`);
  }
  state.phase = next;
  if (state.mode === "greenfield") {
    if (next === "CONVERGE") {
      addGate(state, "CONVERGE-shortlist", "human", "shortlisted");
      addGate(state, "CONVERGE", "human", "decided");
      state.convergence = { shortlist: [], decisions: {}, agree: null, tiebreak: null, chosen: null, ledger: [], spikes: [], acceptedUnknowns: [], decided: false };
    } else if (next === "SPECIFY") {
      addGate(state, "SPECIFY-coverage", "human", "covered");
      addGate(state, "SPECIFY", "human", "specified");
      state.spec = { verifyCmd: null, checks: [], redProof: null, gameability: null, certified: false };
    } else if (next === "BUILD") {
      if (!state.spec || state.spec.certified !== true || !state.spec.verifyCmd) {
        throw new Error("cannot enter BUILD: SPECIFY has not certified a verifyCmd SSOT");
      }
      state.plan = { verifyCmd: state.spec.verifyCmd, sprints: [] };   // locked to the certified SSOT
      addGate(state, "BUILD-plan", "human", "planned");
    }
  } else if (next !== "IMPLEMENT" && next !== "FINISH") {
    const approveFrom = next === "VERIFY" ? "verified" : next === "PLAN" ? "planned" : "rendered";
    addGate(state, next, "human", approveFrom);
  }
  return state;
}

export function advanceRun({ runDir: dir, now }) {
  const state = readState(dir);
  const from = state.phase;
  if (state.phase === "IMPLEMENT" || (state.mode === "greenfield" && state.phase === "BUILD")) {
    // 1. Eligibility: a mid-implementation run must not run the final acceptance command at all.
    //    (Mirrors advancePhase's guard, with the existing message, so it fires BEFORE the live verify.)
    if (!allSprintsDone(state)) throw new Error(notAllSprintsDoneMessage(state));
    // 2. Historical ledger honesty (unchanged).
    const audit = auditRun({ runDir: dir });
    if (!audit.ok) throw new Error(`cannot advance to FINISH: audit failed: ${audit.failures.join("; ")}`);
    // 3. Live re-verify: the locked verifyCmd must pass against the CURRENT workspace, not just historically.
    const projectRoot = path.resolve(dir, "..", "..", "..", "..");   // runDir = <root>/docs/superpowers/loop-runs/<id>
    const cmd = state.plan?.verifyCmd;
    if (!cmd) throw new Error("cannot advance to FINISH: no verifyCmd in plan");
    const result = runVerification(cmd, projectRoot);
    if (result.exitCode !== 0) throw new Error(`cannot advance to FINISH: verifyCmd is currently red (exit ${result.exitCode}): ${cmd}`);
    // 4. Only now, after honesty AND liveness pass, record the final-verification.
    appendLedger(dir, { at: now ?? new Date().toISOString(), type: "final-verification", command: cmd, exitCode: 0 });
    const finishCmd = state.plan?.finishCmd;
    if (finishCmd) {
      const finishResult = runVerification(finishCmd, projectRoot);
      if (finishResult.exitCode !== 0) {
        throw new Error(`cannot advance to FINISH: finishCmd is currently red (exit ${finishResult.exitCode}): ${finishCmd}`);
      }
      appendLedger(dir, { at: now ?? new Date().toISOString(), type: "final-finish-verification", command: finishCmd, exitCode: 0 });
    }
  }
  // verified:true — advanceRun only reaches a FINISH transition after the live re-verify above (FINISH's
  // only predecessors are IMPLEMENT/BUILD, which always go through that block).
  advancePhase(state, { verified: true });
  writeState(dir, state);
  appendLedger(dir, { at: now ?? new Date().toISOString(), type: "phase-advanced", from, to: state.phase });
  return state;
}
