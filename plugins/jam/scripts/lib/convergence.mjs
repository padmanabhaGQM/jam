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

export function recordDecision({ runDir: dir, agent, chosen, rationale, spikes, now }) {
  if (!["claude", "codex"].includes(agent)) throw new Error(`recordDecision: agent must be "claude" or "codex"`);
  if (!chosen) throw new Error("recordDecision: a chosen option is required");
  const state = readState(dir);
  requireConverge(state);
  if (state.gates["CONVERGE-shortlist"].status !== "approved") throw new Error("recordDecision: the CONVERGE-shortlist gate must be approved first");
  if (!state.convergence.shortlist.includes(chosen)) throw new Error(`recordDecision: chosen "${chosen}" is not in the approved shortlist`);
  const c = state.convergence;
  c.decisions[agent] = { chosen, rationale: rationale ?? null, spikes: Array.isArray(spikes) ? spikes : [] };
  if (c.decisions.claude && c.decisions.codex) {
    c.agree = c.decisions.claude.chosen === c.decisions.codex.chosen;
    if (c.agree) {
      c.chosen = c.decisions.claude.chosen;
      delete state.gates["CONVERGE-tiebreak"];   // a fresh agreement dissolves a stale tiebreak
      c.tiebreak = null;
    } else {
      c.chosen = null;
      c.tiebreak = null;
      if (!state.gates["CONVERGE-tiebreak"]) addGate(state, "CONVERGE-tiebreak", "human", "contested");
      state.gates["CONVERGE-tiebreak"].status = "contested";
    }
  }
  const reopened = reopenDecision(state);
  writeState(dir, state);
  appendLedger(dir, { at: nowIso(now), type: "decision-recorded", agent, chosen });
  if (reopened) appendLedger(dir, { at: nowIso(now), type: "convergence-reopened", reason: `decision recorded by ${agent}` });
  return state;
}

export function ruleTiebreak({ runDir: dir, chosen, now }) {
  if (!chosen) throw new Error("ruleTiebreak: a chosen option is required");
  const state = readState(dir);
  requireConverge(state);
  if (state.convergence.agree !== false || !state.gates["CONVERGE-tiebreak"]) {
    throw new Error("ruleTiebreak: no active disagreement to rule — the agents did not disagree");
  }
  if (!state.convergence.shortlist.includes(chosen)) throw new Error(`ruleTiebreak: "${chosen}" is not in the shortlist`);
  state.convergence.tiebreak = { chosen, by: "user", at: nowIso(now) };
  state.convergence.chosen = chosen;
  state.gates["CONVERGE-tiebreak"].status = "approved";
  const reopened = reopenDecision(state);   // re-ruling after a decision invalidates it
  writeState(dir, state);
  appendLedger(dir, { at: nowIso(now), type: "tiebreak-ruled", chosen, who: "user" });
  if (reopened) appendLedger(dir, { at: nowIso(now), type: "convergence-reopened", reason: "tiebreak re-ruled" });
  return state;
}

export function convergeDecision({ runDir: dir, ledger, spikes, acceptedUnknowns, now }) {
  const state = readState(dir);
  requireConverge(state);
  if (state.gates["CONVERGE-shortlist"].status !== "approved") throw new Error("convergeDecision: the CONVERGE-shortlist gate must be approved first");
  const c = state.convergence;
  if (!c.decisions.claude || !c.decisions.codex) throw new Error("convergeDecision: both agent decisions must be recorded");
  if (c.agree === false && (!state.gates["CONVERGE-tiebreak"] || state.gates["CONVERGE-tiebreak"].status !== "approved")) {
    throw new Error("convergeDecision: the agents disagree — rule the tiebreak first (jam converge tiebreak --choose <opt>)");
  }
  if (!c.chosen || !c.shortlist.includes(c.chosen)) throw new Error("convergeDecision: no chosen option in the approved shortlist");
  if (Array.isArray(ledger)) c.ledger = ledger;
  if (Array.isArray(spikes)) c.spikes = spikes;
  if (Array.isArray(acceptedUnknowns)) c.acceptedUnknowns = acceptedUnknowns;
  const dims = (state.grounding && Array.isArray(state.grounding.dimensions)) ? state.grounding.dimensions : [];
  if (dims.length === 0) throw new Error("convergeDecision: a grounded decision needs at least one acceptance dimension");
  const spikeByRef = new Map();
  for (const s of (c.spikes ?? [])) {
    if (!s.evidenceRef || !fs.existsSync(s.evidenceRef)) throw new Error(`convergeDecision: spike ${s.id} has no locatable transcript`);
    spikeByRef.set(s.evidenceRef, s);
  }
  const covered = new Set(c.ledger.map((r) => r.dimension));
  for (const d of dims) {
    if (!covered.has(d)) throw new Error(`convergeDecision: dimension "${d}" is missing from the decision-ledger`);
  }
  for (const r of c.ledger) {
    if (r.status === "satisfied") {
      const sp = r.evidenceRef ? spikeByRef.get(r.evidenceRef) : null;
      if (!sp) throw new Error(`convergeDecision: dimension "${r.dimension}" is 'satisfied' but its evidenceRef is not a registered spike`);
      if (sp.dimension !== r.dimension) throw new Error(`convergeDecision: dimension "${r.dimension}" is 'satisfied' by a spike registered for a different dimension (${sp.dimension ?? "none"})`);
    } else if (r.status === "at-risk" || r.status === "unmet") {
      if (r.accepted !== true) throw new Error(`convergeDecision: dimension "${r.dimension}" is '${r.status}' and not accepted — accept the risk (accepted:true) or change the decision`);
    }
  }
  // every carried-forward G1 open-unknown must be explicitly accepted
  const accepted = new Set(c.acceptedUnknowns ?? []);
  for (const u of (state.grounding?.openUnknowns ?? [])) {
    if (!accepted.has(u)) throw new Error(`convergeDecision: open-unknown "${u}" is not in acceptedUnknowns — resolve or accept it`);
  }
  c.decided = true;
  state.gates["CONVERGE"].status = "decided";
  writeState(dir, state);
  appendLedger(dir, { at: nowIso(now), type: "convergence-decided", chosen: c.chosen, dimensions: dims.length });
  return state;
}
