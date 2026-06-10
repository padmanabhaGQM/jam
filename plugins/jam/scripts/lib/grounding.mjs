import fs from "node:fs";
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
  writeState(dir, state);
  appendLedger(dir, { at: nowIso(now), type: status === "evidenced" ? "claim-evidenced" : "claim-added", id, kind, source });
  return state;
}

export function refuteClaim({ runDir: dir, id, now }) {
  const state = readState(dir);
  requireGreenfield(state);
  const before = state.grounding.claims.length;
  state.grounding.claims = state.grounding.claims.filter((c) => c.id !== id);
  if (state.grounding.claims.length === before) throw new Error(`refuteClaim: unknown claim ${id}`);
  writeState(dir, state);
  appendLedger(dir, { at: nowIso(now), type: "claim-refuted", id });
  return state;
}
