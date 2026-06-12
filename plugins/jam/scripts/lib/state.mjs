import fs from "node:fs";
import path from "node:path";
import { phaseOrderFor } from "./mode.mjs";

const VALID_MODES = ["human", "show-and-proceed", "auto"];
const VALID_STATUSES = ["pending", "rendered", "verified", "planned", "evidence-passed", "approved", "rejected", "ratified", "scoped", "grounded", "shortlisted", "contested", "decided", "covered", "specified"];
const VALID_ACTION_STATUSES = new Set(["proposed", "ratified", "denied", "allowed"]);

export function createInitialState({ runId, topic, now, mode }) {
  if (!runId) throw new Error("createInitialState: runId required");
  const repair = mode === "repair";
  const greenfield = mode === "greenfield";
  const phase = repair ? "DIAGNOSE" : greenfield ? "GROUND" : "ALIGN";
  const state = {
    runId,
    topic: topic ?? "",
    phase,
    currentSprint: null,
    createdAt: now ?? new Date().toISOString(),
    gates: {},
    dial: {},
    coverage: [],
    steeringDirectives: [],
    runaway: {}
  };
  const humanGate = (approveFrom) => ({ mode: "human", status: "pending", approvedBy: null, approvedAt: null, evidenceRef: null, approveFrom });
  if (greenfield) {
    state.gates["GROUND-scope"] = humanGate("scoped");
    state.gates["GROUND"] = humanGate("grounded");
    state.mode = "greenfield";
    state.goalRef = null;
    state.goalSource = null;
    state.grounding = { problem: null, dimensions: [], options: [], claims: [], openUnknowns: [], converged: false };
  } else {
    const firstGate = repair ? "DIAGNOSE" : "ALIGN";
    state.gates[firstGate] = humanGate("rendered");
  }
  if (repair) {
    state.mode = "repair";
    state.goalRef = null;
    state.goalSource = null;
  }
  return state;
}

export function validateState(state) {
  const errors = [];
  if (!state || typeof state !== "object") {
    errors.push("state must be an object");
    return errors;
  }
  for (const k of ["runId", "phase", "gates", "dial", "createdAt"]) {
    if (!(k in state)) errors.push(`state missing required field: ${k}`);
  }
  if ("mode" in state && !["repair", "greenfield"].includes(state.mode)) {
    errors.push(`invalid mode: ${state.mode}`);
  }
  if (typeof state.phase === "string" && state.mode && !phaseOrderFor(state.mode).includes(state.phase)) {
    errors.push(`phase ${state.phase} is not a valid phase for mode ${state.mode}`);
  }
  for (const [id, g] of Object.entries(state.gates ?? {})) {
    if (!VALID_MODES.includes(g.mode)) errors.push(`gate ${id}: invalid mode ${g.mode}`);
    if (!VALID_STATUSES.includes(g.status)) errors.push(`gate ${id}: invalid status ${g.status}`);
  }
  for (const sp of state.plan?.sprints ?? []) {
    if ("turn" in sp && sp.turn !== null) {
      const t = sp.turn;
      if (typeof t.token !== "string") errors.push(`sprint ${sp.id}: turn.token must be a string`);
      if (!["open", "reconciled", "discarded"].includes(t.status)) errors.push(`sprint ${sp.id}: turn.status invalid`);
    }
    if ("turnSeq" in sp && !Number.isInteger(sp.turnSeq)) errors.push(`sprint ${sp.id}: turnSeq must be an integer`);
    if ("codexSessions" in sp) {
      if (!Array.isArray(sp.codexSessions)) {
        errors.push(`sprint ${sp.id}: codexSessions must be an array`);
      } else {
        for (const cs of sp.codexSessions) {
          if (!cs || typeof cs.sessionId !== "string" || typeof cs.at !== "string") {
            errors.push(`sprint ${sp.id}: each codexSession needs string sessionId and at`);
          }
        }
      }
    }
    if ("provenance" in sp && !["planned", "promoted"].includes(sp.provenance)) {
      errors.push(`sprint ${sp.id}: provenance must be "planned" or "promoted"`);
    }
    if ("needs" in sp && (!Array.isArray(sp.needs) || sp.needs.some((n) => typeof n !== "string"))) {
      errors.push(`sprint ${sp.id}: needs must be an array of sprint ids`);
    }
    if (sp.status === "done" && !(sp.codexSessions ?? []).length) {
      errors.push(`sprint ${sp.id}: status is done but has no bound Codex session`);
    }
  }
  if ("promotions" in state) {
    if (!Array.isArray(state.promotions)) {
      errors.push("promotions must be an array");
    } else {
      for (const p of state.promotions) {
        if (!p || typeof p.id !== "string" || typeof p.reason !== "string") {
          errors.push("each promotion needs a string id and reason");
        }
      }
    }
  }
  if ("actions" in state) {
    if (!Array.isArray(state.actions)) {
      errors.push("actions must be an array");
    } else {
      for (const a of state.actions) {
        if (!a || typeof a.id !== "string" || typeof a.irreversible !== "boolean") {
          errors.push("each action needs a string id and boolean irreversible");
        } else if (!VALID_ACTION_STATUSES.has(a.status)) {
          errors.push(`action ${a.id} has invalid status "${a.status}"`);
        }
      }
    }
  }
  if (state.grounding && Array.isArray(state.grounding.claims)) {
    for (const c of state.grounding.claims) {
      const ok = c && typeof c.id === "string" && typeof c.text === "string" && c.text.length > 0
        && ["feasibility", "framing", "option"].includes(c.kind)
        && ["evidenced", "open-unknown"].includes(c.status)
        && ["claude", "codex", "both"].includes(c.source);
      if (!ok) errors.push(`grounding claim invalid: ${c && c.id ? c.id : "(unnamed)"}`);
      else if (c.kind === "feasibility" && c.status === "evidenced" && (typeof c.evidenceRef !== "string" || c.evidenceRef.length === 0)) {
        errors.push(`grounding claim ${c.id}: an evidenced feasibility claim must carry an evidenceRef`);
      }
    }
  }
  if (state.convergence && Array.isArray(state.convergence.ledger)) {
    for (const r of state.convergence.ledger) {
      const ok = r && typeof r.dimension === "string" && ["satisfied", "at-risk", "unmet"].includes(r.status);
      if (!ok) { errors.push(`convergence ledger row invalid: ${r && r.dimension ? r.dimension : "(unnamed)"}`); continue; }
      if (r.status === "satisfied" && (typeof r.evidenceRef !== "string" || r.evidenceRef.length === 0)) {
        errors.push(`convergence ledger ${r.dimension}: a 'satisfied' dimension must carry an evidenceRef`);
      }
      if ((r.status === "unmet" || r.status === "at-risk") && r.accepted !== true) {
        errors.push(`convergence ledger ${r.dimension}: a '${r.status}' dimension must be accepted (accepted:true)`);
      }
    }
  }
  if (state.convergence && state.gates && state.gates["CONVERGE"] &&
      ["decided", "approved"].includes(state.gates["CONVERGE"].status) && state.convergence.decided !== true) {
    errors.push("CONVERGE gate is decided/approved but convergence.decided is not true");
  }
  if (state.spec && Array.isArray(state.spec.checks)) {
    for (const c of state.spec.checks) {
      if (!c || typeof c.id !== "string" || typeof c.dimension !== "string" || typeof c.ref !== "string") {
        errors.push(`spec check invalid: ${c && c.id ? c.id : "(unnamed)"}`);
      }
    }
  }
  if (state.gates && state.gates["SPECIFY"] && ["specified", "approved"].includes(state.gates["SPECIFY"].status)) {
    if (!state.spec || state.spec.certified !== true) {
      errors.push("SPECIFY gate is specified/approved but spec is missing or not certified");
    }
  }
  if (state.mode === "greenfield" && (state.phase === "BUILD" || state.phase === "FINISH")) {
    if (!state.spec || state.spec.certified !== true) errors.push("greenfield BUILD: spec must be certified");
    const sv = state.spec && state.spec.verifyCmd;
    const pv = state.plan && state.plan.verifyCmd;
    if (typeof sv !== "string" || sv.length === 0) errors.push("greenfield BUILD: spec.verifyCmd (certified SSOT) is required");
    if (typeof pv !== "string" || pv.length === 0) errors.push("greenfield BUILD: plan.verifyCmd is required");
    if (typeof sv === "string" && typeof pv === "string" && sv !== pv) errors.push("greenfield BUILD: plan.verifyCmd must equal the certified spec.verifyCmd (SSOT)");
    if (!state.gates || !state.gates["BUILD-plan"]) errors.push("greenfield BUILD: a BUILD-plan gate is required");
  }
  return errors;
}

function assertValidState(state) {
  const errors = validateState(state);
  if (errors.length > 0) throw new Error(errors.join("; "));
}

export function statePath(dir) {
  return path.join(dir, "state.json");
}

export function readState(dir) {
  const p = statePath(dir);
  if (!fs.existsSync(p)) throw new Error(`no run state at ${p}`);
  const state = JSON.parse(fs.readFileSync(p, "utf8"));
  assertValidState(state);
  return state;
}

export function writeState(dir, state) {
  assertValidState(state);
  fs.mkdirSync(dir, { recursive: true });
  const p = statePath(dir);
  const tmp = `${p}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, p);
  return p;
}

export function getGate(state, gateId) {
  const g = state.gates[gateId];
  if (!g) throw new Error(`unknown gate: ${gateId} (known gates: ${Object.keys(state.gates ?? {}).join(", ") || "none"})`);
  return g;
}

export function addGate(state, gateId, mode, approveFrom = "rendered") {
  if (!VALID_MODES.includes(mode)) throw new Error(`invalid mode ${mode}`);
  if (state.gates[gateId]) throw new Error(`gate ${gateId} already exists`);
  state.gates[gateId] = { mode, status: "pending", approvedBy: null, approvedAt: null, evidenceRef: null, approveFrom };
  return state;
}
