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
  if (!state || typeof state !== "object") throw new Error("state must be an object");
  for (const k of ["runId", "phase", "gates", "dial", "createdAt"]) {
    if (!(k in state)) throw new Error(`state missing required field: ${k}`);
  }
  for (const [id, g] of Object.entries(state.gates)) {
    if (!VALID_MODES.includes(g.mode)) throw new Error(`gate ${id}: invalid mode ${g.mode}`);
    if (!VALID_STATUSES.includes(g.status)) throw new Error(`gate ${id}: invalid status ${g.status}`);
  }
  return true;
}

export function statePath(dir) {
  return path.join(dir, "state.json");
}

export function readState(dir) {
  const p = statePath(dir);
  if (!fs.existsSync(p)) throw new Error(`no run state at ${p}`);
  const state = JSON.parse(fs.readFileSync(p, "utf8"));
  validateState(state);
  return state;
}

export function writeState(dir, state) {
  validateState(state);
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
