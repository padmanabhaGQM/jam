import fs from "node:fs";
import { readState, writeState } from "./state.mjs";
import { appendLedger } from "./ledger.mjs";
import { evaluateGate } from "./gate.mjs";

function nowIso(now) { return now ?? new Date().toISOString(); }

function requireGreenfield(state) {
  if (state.mode !== "greenfield") throw new Error(`grounding applies only to greenfield runs (mode=${state.mode ?? "repair"})`);
  if (state.phase !== "GROUND") throw new Error(`grounding is frozen after the GROUND phase (phase=${state.phase}) — the grounded-intent cannot be changed`);
  if (!state.grounding) throw new Error("grounding block missing from state");
}

// Any change to the intent or claim-ledger after a convergence invalidates it:
// re-arm the GROUND gate so a human cannot ratify a stale grounding. Returns true if it re-armed.
function reopenConvergence(state) {
  const past = state.grounding.converged === true || ["grounded", "approved"].includes(state.gates["GROUND"].status);
  if (!past) return false;
  state.grounding.converged = false;
  if (["grounded", "approved"].includes(state.gates["GROUND"].status)) state.gates["GROUND"].status = "pending";
  return true;
}

export function sharpenIntent({ runDir: dir, problem, dimensions, now }) {
  if (!problem || !problem.trim()) throw new Error("sharpenIntent: a non-empty problem statement is required");
  if (!Array.isArray(dimensions) || dimensions.length === 0) throw new Error("sharpenIntent: at least one acceptance dimension is required");
  const state = readState(dir);
  requireGreenfield(state);
  const wasApproved = state.gates["GROUND-scope"].status === "approved";
  state.grounding.problem = problem;
  state.grounding.dimensions = dimensions;
  state.gates["GROUND-scope"].status = "scoped";
  const reopened = reopenConvergence(state);
  writeState(dir, state);
  appendLedger(dir, { at: nowIso(now), type: "intent-sharpened" });
  if (wasApproved) appendLedger(dir, { at: nowIso(now), type: "scope-reopened" });
  if (reopened) appendLedger(dir, { at: nowIso(now), type: "grounding-reopened", reason: "intent re-sharpened" });
  return state;
}

const CLAIM_KINDS = new Set(["feasibility", "framing", "option"]);
const CLAIM_STATUSES = new Set(["evidenced", "open-unknown"]);
const CLAIM_SOURCES = new Set(["claude", "codex", "both"]);

export function addClaim({ runDir: dir, id, text, kind, status, source, evidenceRef, now }) {
  if (!id) throw new Error("addClaim: a claim id is required");
  if (!text || !text.trim()) throw new Error("addClaim: claim text is required");
  if (!CLAIM_KINDS.has(kind)) throw new Error(`addClaim: invalid kind "${kind}" (feasibility|framing|option)`);
  if (!CLAIM_STATUSES.has(status)) throw new Error(`addClaim: invalid status "${status}" (evidenced|open-unknown; refuted claims are dropped, not added)`);
  if (!CLAIM_SOURCES.has(source)) throw new Error(`addClaim: invalid source "${source}" (claude|codex|both)`);
  const state = readState(dir);
  requireGreenfield(state);
  if (state.grounding.claims.some((c) => c.id === id)) throw new Error(`addClaim: claim ${id} already exists`);
  if (kind === "feasibility" && status === "evidenced") {
    if (!evidenceRef) throw new Error(`addClaim: a feasibility claim needs an evidenceRef (a Codex probe transcript)`);
    if (!fs.existsSync(evidenceRef)) throw new Error(`addClaim: evidence transcript not found at ${evidenceRef} (does not exist)`);
  }
  state.grounding.claims.push({ id, text, kind, status, source, evidenceRef: evidenceRef ?? null });
  const reopened = reopenConvergence(state);
  writeState(dir, state);
  appendLedger(dir, { at: nowIso(now), type: status === "evidenced" ? "claim-evidenced" : "claim-added", id, kind, source });
  if (reopened) appendLedger(dir, { at: nowIso(now), type: "grounding-reopened", reason: `claim ${id} added after convergence` });
  return state;
}

export function refuteClaim({ runDir: dir, id, now }) {
  const state = readState(dir);
  requireGreenfield(state);
  const before = state.grounding.claims.length;
  state.grounding.claims = state.grounding.claims.filter((c) => c.id !== id);
  if (state.grounding.claims.length === before) throw new Error(`refuteClaim: unknown claim ${id}`);
  const reopened = reopenConvergence(state);
  writeState(dir, state);
  appendLedger(dir, { at: nowIso(now), type: "claim-refuted", id });
  if (reopened) appendLedger(dir, { at: nowIso(now), type: "grounding-reopened", reason: `claim ${id} refuted after convergence` });
  return state;
}

export function convergeGrounding({ runDir: dir, options, openUnknowns, now }) {
  const state = readState(dir);
  requireGreenfield(state);
  if (!evaluateGate(state, "GROUND-scope").allowed) {
    throw new Error("convergeGrounding: the GROUND-scope gate must be approved before converging");
  }
  const g = state.grounding;
  if (!g.problem || !g.problem.trim()) throw new Error("convergeGrounding: no problem statement (run sharpenIntent first)");
  if (!Array.isArray(g.dimensions) || g.dimensions.length === 0) throw new Error("convergeGrounding: no acceptance dimensions");
  for (const c of g.claims) {
    if (!["evidenced", "open-unknown"].includes(c.status)) {
      throw new Error(`convergeGrounding: claim ${c.id} is unsupported (status=${c.status}) — evidence it or drop it`);
    }
    if (c.kind === "feasibility" && c.status === "evidenced") {
      if (!c.evidenceRef || !fs.existsSync(c.evidenceRef)) {
        throw new Error(`convergeGrounding: feasibility claim ${c.id} has no locatable evidence transcript (not found at ${c.evidenceRef ?? "(none)"})`);
      }
    }
  }
  if (Array.isArray(options)) g.options = options;
  if (Array.isArray(openUnknowns)) g.openUnknowns = openUnknowns;
  g.converged = true;
  state.gates["GROUND"].status = "grounded";
  writeState(dir, state);
  appendLedger(dir, { at: nowIso(now), type: "grounding-converged", claims: g.claims.length, openUnknowns: g.openUnknowns.length });
  return state;
}
