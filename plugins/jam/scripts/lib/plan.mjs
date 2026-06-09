import fs from "node:fs";
import path from "node:path";
import { readState, writeState, getGate } from "./state.mjs";
import { appendLedger } from "./ledger.mjs";

export function validatePlan(plan) {
  const errors = [];
  if (!plan || typeof plan !== "object") return { valid: false, errors: ["plan must be an object"] };
  if (!plan.verifyCmd || !String(plan.verifyCmd).trim()) errors.push("missing verifyCmd");
  if (!Array.isArray(plan.sprints) || plan.sprints.length === 0) {
    errors.push("sprints must be a non-empty array");
  } else {
    const ids = new Set();
    plan.sprints.forEach((s, i) => {
      if (!s || typeof s !== "object") { errors.push(`sprint[${i}] must be an object`); return; }
      if (!s.id) errors.push(`sprint[${i}] missing id`);
      if (!s.title) errors.push(`sprint[${i}] missing title`);
      if (s.id) { if (ids.has(s.id)) errors.push(`duplicate sprint id: ${s.id}`); ids.add(s.id); }
    });
  }
  return { valid: errors.length === 0, errors };
}

export function recordPlan({ runDir: dir, plan, now }) {
  const { valid, errors } = validatePlan(plan);
  if (!valid) throw new Error(`invalid plan: ${errors.join("; ")}`);
  const state = readState(dir);
  let g;
  try { g = getGate(state, "PLAN"); } catch { throw new Error("cannot record plan: not in PLAN phase (no PLAN gate)"); }
  if (g.approveFrom !== "planned") throw new Error(`gate PLAN is not a plan gate (approveFrom=${g.approveFrom})`);
  if (g.status === "approved") throw new Error("cannot record plan: PLAN gate already approved (cancel or rewind to change it)");
  fs.writeFileSync(path.join(dir, "plan.json"), JSON.stringify(plan, null, 2));
  state.plan = {
    verifyCmd: plan.verifyCmd,
    sprints: plan.sprints.map((s) => ({ id: s.id, title: s.title, acceptanceCriteria: s.acceptanceCriteria ?? "", status: "pending", provenance: "planned" }))
  };
  g.status = "planned";
  writeState(dir, state);
  appendLedger(dir, { at: now ?? new Date().toISOString(), type: "plan-recorded", sprints: plan.sprints.length });
  return state;
}

export function promoteSprint({ runDir: dir, id, title, acceptanceCriteria, discoveredBy, reason, now }) {
  const state = readState(dir);
  if (state.phase !== "IMPLEMENT") throw new Error(`cannot promote a sprint: phase is ${state.phase}, not IMPLEMENT`);
  if (!id || !title) throw new Error("promote-sprint requires id and title");
  if (!reason) throw new Error("promote-sprint requires a reason");
  const sprints = state.plan?.sprints ?? [];
  if (sprints.some((s) => s.id === id)) throw new Error(`sprint ${id} already exists`);
  const at = now ?? new Date().toISOString();
  sprints.push({ id, title, acceptanceCriteria: acceptanceCriteria ?? "", status: "pending", provenance: "promoted" });
  state.plan.sprints = sprints;
  state.promotions = state.promotions ?? [];
  state.promotions.push({ id, discoveredBy: discoveredBy ?? "orchestrator", reason, decidedBy: "orchestrator", at });
  writeState(dir, state);
  appendLedger(dir, { at, type: "sprint-promoted", id, reason });
  return state;
}
