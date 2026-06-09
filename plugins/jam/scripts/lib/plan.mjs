import fs from "node:fs";
import path from "node:path";
import { readState, writeState, getGate } from "./state.mjs";
import { appendLedger } from "./ledger.mjs";

export function validateSprintGraph(sprints) {
  const errors = [];
  const ids = new Set(sprints.map((s) => s.id));
  for (const s of sprints) {
    const needs = s.needs ?? [];
    if (!Array.isArray(needs)) { errors.push(`sprint ${s.id}: needs must be an array`); continue; }
    for (const n of needs) {
      if (n === s.id) errors.push(`sprint ${s.id}: cannot depend on itself`);
      else if (!ids.has(n)) errors.push(`sprint ${s.id}: needs unknown sprint ${n}`);
    }
  }
  const adj = new Map(sprints.map((s) => [s.id, (Array.isArray(s.needs) ? s.needs : []).filter((n) => ids.has(n))]));
  const color = new Map([...ids].map((id) => [id, 0])); // 0=white 1=gray 2=black
  let cyclic = false;
  const dfs = (u) => {
    color.set(u, 1);
    for (const v of adj.get(u) ?? []) {
      if (color.get(v) === 1) { cyclic = true; return; }
      if (color.get(v) === 0) dfs(v);
    }
    color.set(u, 2);
  };
  for (const id of ids) if (color.get(id) === 0) dfs(id);
  if (cyclic) errors.push("sprint graph has a cycle");
  return errors;
}

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
  if (Array.isArray(plan.sprints)) errors.push(...validateSprintGraph(plan.sprints));
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
    sprints: plan.sprints.map((s) => ({ id: s.id, title: s.title, acceptanceCriteria: s.acceptanceCriteria ?? "", status: "pending", provenance: "planned", needs: Array.isArray(s.needs) ? s.needs : [] }))
  };
  g.status = "planned";
  writeState(dir, state);
  appendLedger(dir, { at: now ?? new Date().toISOString(), type: "plan-recorded", sprints: plan.sprints.length });
  return state;
}

export function promoteSprint({ runDir: dir, id, title, acceptanceCriteria, discoveredBy, reason, needs, now }) {
  const state = readState(dir);
  if (state.phase !== "IMPLEMENT") throw new Error(`cannot promote a sprint: phase is ${state.phase}, not IMPLEMENT`);
  if (!id || !title) throw new Error("promote-sprint requires id and title");
  if (!reason) throw new Error("promote-sprint requires a reason");
  if (!state.plan) throw new Error("cannot promote a sprint: no plan has been recorded");
  const sprints = state.plan?.sprints ?? [];
  if (sprints.some((s) => s.id === id)) throw new Error(`sprint ${id} already exists`);
  const at = now ?? new Date().toISOString();
  const candidate = [...sprints, { id, title, acceptanceCriteria: acceptanceCriteria ?? "", status: "pending", provenance: "promoted", needs: Array.isArray(needs) ? needs : [] }];
  const gErrors = validateSprintGraph(candidate);
  if (gErrors.length) throw new Error(`promotion creates an invalid sprint graph: ${gErrors.join("; ")}`);
  state.plan.sprints = candidate;
  state.promotions = state.promotions ?? [];
  state.promotions.push({ id, discoveredBy: discoveredBy ?? "orchestrator", reason, decidedBy: "orchestrator", at });
  writeState(dir, state);
  appendLedger(dir, { at, type: "sprint-promoted", id, reason });
  return state;
}
