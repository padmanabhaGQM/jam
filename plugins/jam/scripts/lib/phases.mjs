import { readState, writeState, addGate } from "./state.mjs";
import { evaluateGate } from "./gate.mjs";
import { appendLedger } from "./ledger.mjs";
import { allSprintsDone } from "./sprint.mjs";
import { auditRun } from "./audit.mjs";
import { phaseOrderFor, GREENFIELD_STUB_PHASES, GREENFIELD_STUB_SLICE } from "./mode.mjs";

export { repairPhaseOrder } from "./mode.mjs";

export function advancePhase(state) {
  const order = phaseOrderFor(state.mode);
  const i = order.indexOf(state.phase);
  if (i === -1) throw new Error(`advancePhase: ${state.phase} is not a phase in mode ${state.mode ?? "repair"}`);
  const next = order[i + 1];
  if (!next) throw new Error(state.mode === "greenfield" ? `already at the final phase (${state.phase})` : `already at the final repair phase (${state.phase})`);
  if (state.phase === "IMPLEMENT") {
    if (!allSprintsDone(state)) throw new Error(`cannot advance from IMPLEMENT: not all sprints done`);
  } else {
    const { allowed, reason } = evaluateGate(state, state.phase);
    if (!allowed) throw new Error(`cannot advance from ${state.phase}: ${reason}`);
  }
  if (state.mode === "greenfield" && GREENFIELD_STUB_PHASES.has(next)) {
    throw new Error(`phase ${next} is not yet implemented (ships in ganjam ${GREENFIELD_STUB_SLICE[next]})`);
  }
  state.phase = next;
  if (state.mode !== "greenfield" && next !== "IMPLEMENT" && next !== "FINISH") {
    const approveFrom = next === "VERIFY" ? "verified" : next === "PLAN" ? "planned" : "rendered";
    addGate(state, next, "human", approveFrom);
  }
  return state;
}

export function advanceRun({ runDir: dir, now }) {
  const state = readState(dir);
  const from = state.phase;
  if (state.phase === "IMPLEMENT") {
    const audit = auditRun({ runDir: dir });
    if (!audit.ok) throw new Error(`cannot advance to FINISH: audit failed: ${audit.failures.join("; ")}`);
  }
  advancePhase(state);
  writeState(dir, state);
  appendLedger(dir, { at: now ?? new Date().toISOString(), type: "phase-advanced", from, to: state.phase });
  return state;
}
