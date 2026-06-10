import { readState, writeState } from "./state.mjs";
import { appendLedger } from "./ledger.mjs";
import { runVerification } from "./evidence.mjs";

function nowIso(now) { return now ?? new Date().toISOString(); }

function requireSpecify(state) {
  if (state.mode !== "greenfield") throw new Error(`spec applies only to greenfield runs (mode=${state.mode ?? "repair"})`);
  if (state.phase !== "SPECIFY") throw new Error(`spec requires the SPECIFY phase (phase=${state.phase})`);
  if (!state.spec) throw new Error("spec block missing from state");
}

// Any suite change after certification invalidates it: re-arm the SPECIFY gate so a human cannot ratify a
// stale verifyCmd. The proofs (redProof/gameability) are cleared by setCoverage directly (suite changed).
function reopenSpec(state) {
  const past = state.spec.certified === true || ["specified", "approved"].includes(state.gates["SPECIFY"].status);
  if (!past) return false;
  state.spec.certified = false;
  if (["specified", "approved"].includes(state.gates["SPECIFY"].status)) state.gates["SPECIFY"].status = "pending";
  return true;
}

export function setCoverage({ runDir: dir, verifyCmd, checks, now }) {
  if (!verifyCmd || !verifyCmd.trim()) throw new Error("setCoverage: a non-empty verifyCmd is required");
  if (!Array.isArray(checks) || checks.length === 0) throw new Error("setCoverage: at least one check is required");
  for (const c of checks) {
    if (!c || typeof c.id !== "string" || typeof c.dimension !== "string" || typeof c.ref !== "string") {
      throw new Error("setCoverage: each check needs a string id, dimension, and ref");
    }
  }
  const state = readState(dir);
  requireSpecify(state);
  // gate-1 coverage mechanism: every G2 acceptance dimension must be bound to >=1 check (and be non-blank)
  const dims = (state.convergence && Array.isArray(state.convergence.ledger)) ? state.convergence.ledger.map((r) => r.dimension) : [];
  if (dims.length === 0) throw new Error("setCoverage: no acceptance dimensions from the converged decision");
  if (dims.some((d) => !d || !d.trim())) throw new Error("setCoverage: an acceptance dimension is blank");
  const haveChecks = new Set(checks.map((c) => c.dimension));
  for (const d of dims) {
    if (!haveChecks.has(d)) throw new Error(`setCoverage: acceptance dimension "${d}" has no check`);
  }
  const wasApproved = state.gates["SPECIFY-coverage"].status === "approved";
  state.spec.verifyCmd = verifyCmd;
  state.spec.checks = checks;
  state.spec.redProof = null;       // the suite changed: stale proofs are cleared
  state.spec.gameability = null;
  const reopened = reopenSpec(state);
  state.gates["SPECIFY-coverage"].status = "covered";
  writeState(dir, state);
  appendLedger(dir, { at: nowIso(now), type: "coverage-set", checks: checks.length });
  if (wasApproved) appendLedger(dir, { at: nowIso(now), type: "coverage-reopened" });
  if (reopened) appendLedger(dir, { at: nowIso(now), type: "spec-reopened", reason: "suite changed" });
  return state;
}

export function recordRedProof({ runDir: dir, cwd, now }) {
  const state = readState(dir);
  requireSpecify(state);
  if (state.gates["SPECIFY-coverage"].status !== "approved") throw new Error("recordRedProof: the SPECIFY-coverage gate must be approved first");
  if (!state.spec.verifyCmd) throw new Error("recordRedProof: no verifyCmd set");
  const result = runVerification(state.spec.verifyCmd, cwd ?? dir);
  state.spec.redProof = { exitCode: result.exitCode, at: nowIso(now) };
  const reopened = reopenSpec(state);   // a new proof after certification invalidates it
  writeState(dir, state);
  appendLedger(dir, { at: nowIso(now), type: "redproof-recorded", exitCode: result.exitCode });
  if (reopened) appendLedger(dir, { at: nowIso(now), type: "spec-reopened", reason: "red-proof re-recorded after certification" });
  return state;
}
