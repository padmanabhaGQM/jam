import fs from "node:fs";
import path from "node:path";

const VALID_MODES = ["human", "show-and-proceed", "auto"];
const VALID_STATUSES = ["pending", "rendered", "verified", "planned", "evidence-passed", "approved", "rejected"];

export function createInitialState({ runId, topic, now, mode }) {
  if (!runId) throw new Error("createInitialState: runId required");
  const repair = mode === "repair";
  const phase = repair ? "DIAGNOSE" : "ALIGN";
  const firstGate = repair ? "DIAGNOSE" : "ALIGN";
  const state = {
    runId,
    topic: topic ?? "",
    phase,
    currentSprint: null,
    createdAt: now ?? new Date().toISOString(),
    gates: {
      [firstGate]: { mode: "human", status: "pending", approvedBy: null, approvedAt: null, evidenceRef: null, approveFrom: "rendered" }
    },
    dial: {},
    coverage: [],
    steeringDirectives: [],
    runaway: {}
  };
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
