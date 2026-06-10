import fs from "node:fs";
import path from "node:path";

const VALID_MODES = ["human", "show-and-proceed", "auto"];
const VALID_STATUSES = ["pending", "rendered", "verified", "planned", "evidence-passed", "approved", "rejected", "ratified", "scoped", "grounded"];
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
  for (const [id, g] of Object.entries(state.gates ?? {})) {
    if (!VALID_MODES.includes(g.mode)) errors.push(`gate ${id}: invalid mode ${g.mode}`);
    if (!VALID_STATUSES.includes(g.status)) errors.push(`gate ${id}: invalid status ${g.status}`);
  }
  for (const sp of state.plan?.sprints ?? []) {
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
  if (!g) throw new Error(`unknown gate: ${gateId}`);
  return g;
}

export function addGate(state, gateId, mode, approveFrom = "rendered") {
  if (!VALID_MODES.includes(mode)) throw new Error(`invalid mode ${mode}`);
  if (state.gates[gateId]) throw new Error(`gate ${gateId} already exists`);
  state.gates[gateId] = { mode, status: "pending", approvedBy: null, approvedAt: null, evidenceRef: null, approveFrom };
  return state;
}
