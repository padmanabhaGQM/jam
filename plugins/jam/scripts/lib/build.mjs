import { readState, writeState } from "./state.mjs";
import { appendLedger } from "./ledger.mjs";
import { validatePlan } from "./plan.mjs";   // full plan schema (ids, titles, duplicate ids, acyclic graph)

function nowIso(now) { return now ?? new Date().toISOString(); }

export function recordBuildPlan({ runDir: dir, sprints, verifyCmd, now }) {
  if (!Array.isArray(sprints) || sprints.length === 0) throw new Error("recordBuildPlan: at least one sprint is required");
  const state = readState(dir);
  if (state.mode !== "greenfield") throw new Error(`recordBuildPlan: applies only to greenfield runs (mode=${state.mode ?? "repair"})`);
  if (state.phase !== "BUILD") throw new Error(`recordBuildPlan: requires the BUILD phase (phase=${state.phase})`);
  // the authoritative acceptance bar is the certified SSOT (state.spec.verifyCmd), NOT the (possibly stale) plan.verifyCmd
  if (!state.spec || state.spec.certified !== true || !state.spec.verifyCmd) {
    throw new Error("recordBuildPlan: no certified verifyCmd SSOT (SPECIFY must have certified one)");
  }
  if (verifyCmd !== undefined && verifyCmd !== state.spec.verifyCmd) {
    throw new Error("recordBuildPlan: verifyCmd is locked to the certified SSOT and cannot be changed");
  }
  if (state.gates["BUILD-plan"].status === "approved") throw new Error("recordBuildPlan: BUILD-plan already approved (rewind to change it)");
  // full schema validation (ids, titles, duplicates, acyclic graph) — same validator repair's recordPlan uses
  const { valid, errors } = validatePlan({ verifyCmd: state.spec.verifyCmd, sprints });
  if (!valid) throw new Error(`recordBuildPlan: invalid build plan: ${errors.join("; ")}`);
  const mapped = sprints.map((s) => ({ id: s.id, title: s.title, acceptanceCriteria: s.acceptanceCriteria ?? "", status: "pending", provenance: "planned", needs: Array.isArray(s.needs) ? s.needs : [] }));
  state.plan = state.plan ?? {};
  state.plan.verifyCmd = state.spec.verifyCmd;   // re-assert the lock from the authoritative SSOT
  state.plan.sprints = mapped;
  state.gates["BUILD-plan"].status = "planned";
  writeState(dir, state);
  appendLedger(dir, { at: nowIso(now), type: "plan-recorded", sprints: mapped.length });
  return state;
}
