import { readState, writeState } from "./state.mjs";
import { appendLedger } from "./ledger.mjs";

function nowIso(now) { return now ?? new Date().toISOString(); }

function requireGreenfield(state) {
  if (state.mode !== "greenfield") throw new Error(`grounding applies only to greenfield runs (mode=${state.mode ?? "repair"})`);
  if (!state.grounding) throw new Error("grounding block missing from state");
}

export function sharpenIntent({ runDir: dir, problem, dimensions, now }) {
  if (!problem || !problem.trim()) throw new Error("sharpenIntent: a non-empty problem statement is required");
  if (!Array.isArray(dimensions) || dimensions.length === 0) throw new Error("sharpenIntent: at least one acceptance dimension is required");
  const state = readState(dir);
  requireGreenfield(state);
  state.grounding.problem = problem;
  state.grounding.dimensions = dimensions;
  state.gates["GROUND-scope"].status = "scoped";
  writeState(dir, state);
  appendLedger(dir, { at: nowIso(now), type: "intent-sharpened" });
  return state;
}
