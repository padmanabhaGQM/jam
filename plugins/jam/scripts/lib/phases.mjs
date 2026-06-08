import { readState, writeState, addGate } from "./state.mjs";
import { evaluateGate } from "./gate.mjs";
import { appendLedger } from "./ledger.mjs";

export const repairPhaseOrder = ["DIAGNOSE", "VERIFY", "PLAN", "IMPLEMENT"];

export function advancePhase(state) {
  const i = repairPhaseOrder.indexOf(state.phase);
  if (i === -1) throw new Error(`advancePhase: ${state.phase} is not a repair phase`);
  const next = repairPhaseOrder[i + 1];
  if (!next) throw new Error(`already at the final repair phase (${state.phase})`);
  const { allowed, reason } = evaluateGate(state, state.phase);
  if (!allowed) throw new Error(`cannot advance from ${state.phase}: ${reason}`);
  state.phase = next;
  if (next !== "IMPLEMENT") addGate(state, next, "human");
  return state;
}

export function advanceRun({ runDir: dir, now }) {
  const state = readState(dir);
  const from = state.phase;
  advancePhase(state);
  writeState(dir, state);
  appendLedger(dir, { at: now ?? new Date().toISOString(), type: "phase-advanced", from, to: state.phase });
  return state;
}
