import fs from "node:fs";
import { readState, writeState, addGate } from "./state.mjs";
import { appendLedger } from "./ledger.mjs";

function nowIso(now) { return now ?? new Date().toISOString(); }

function requireConverge(state) {
  if (state.mode !== "greenfield") throw new Error(`convergence applies only to greenfield runs (mode=${state.mode ?? "repair"})`);
  if (state.phase !== "CONVERGE") throw new Error(`convergence requires the CONVERGE phase (phase=${state.phase})`);
  if (!state.convergence) throw new Error("convergence block missing from state");
}

// Any change after a decision invalidates it: re-arm the CONVERGE gate so a human cannot ratify a stale
// decision, AND clear the now-stale ledger/spikes/acceptedUnknowns (they were tied to the prior choice).
function reopenDecision(state) {
  const past = state.convergence.decided === true || ["decided", "approved"].includes(state.gates["CONVERGE"].status);
  if (!past) return false;
  state.convergence.decided = false;
  state.convergence.ledger = [];
  state.convergence.spikes = [];
  state.convergence.acceptedUnknowns = [];
  if (["decided", "approved"].includes(state.gates["CONVERGE"].status)) state.gates["CONVERGE"].status = "pending";
  return true;
}

export function setShortlist({ runDir: dir, options, now }) {
  if (!Array.isArray(options) || options.length === 0) throw new Error("setShortlist: at least one candidate is required");
  if (options.length > 3) throw new Error("setShortlist: at most 3 candidates (keep the field tight)");
  if (new Set(options).size !== options.length) throw new Error("setShortlist: duplicate candidates");
  const state = readState(dir);
  requireConverge(state);
  const wasApproved = state.gates["CONVERGE-shortlist"].status === "approved";
  state.convergence.shortlist = options;
  state.convergence.decisions = {};
  state.convergence.agree = null;
  state.convergence.chosen = null;
  delete state.gates["CONVERGE-tiebreak"];
  state.convergence.tiebreak = null;
  const reopened = reopenDecision(state);
  state.gates["CONVERGE-shortlist"].status = "shortlisted";
  writeState(dir, state);
  appendLedger(dir, { at: nowIso(now), type: "shortlist-set", count: options.length });
  if (wasApproved) appendLedger(dir, { at: nowIso(now), type: "shortlist-reopened" });
  if (reopened) appendLedger(dir, { at: nowIso(now), type: "convergence-reopened", reason: "shortlist changed" });
  return state;
}
