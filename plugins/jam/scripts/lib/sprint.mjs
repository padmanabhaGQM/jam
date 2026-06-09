import { readState, writeState, addGate } from "./state.mjs";
import { recordEvidence } from "./actions.mjs";
import { appendLedger } from "./ledger.mjs";

function nowIso(now) { return now ?? new Date().toISOString(); }
function sprintGateId(id) { return `sprint-${id}`; }

export function allSprintsDone(state) {
  const sprints = state.plan?.sprints ?? [];
  return sprints.length > 0 && sprints.every((s) => s.status === "done");
}

export function startSprint({ runDir: dir, sprintId, now }) {
  const state = readState(dir);
  if (state.phase !== "IMPLEMENT") throw new Error(`cannot start a sprint: phase is ${state.phase}, not IMPLEMENT`);
  const sprint = (state.plan?.sprints ?? []).find((s) => s.id === sprintId);
  if (!sprint) throw new Error(`unknown sprint: ${sprintId}`);
  if (sprint.status !== "pending") throw new Error(`sprint ${sprintId} is ${sprint.status}, not pending`);
  sprint.status = "in-progress";
  addGate(state, sprintGateId(sprintId), "auto");
  writeState(dir, state);
  appendLedger(dir, { at: nowIso(now), type: "sprint-started", sprintId });
  return state;
}

export function verifySprint({ runDir: dir, sprintId, cwd, now }) {
  const state = readState(dir);
  const verifyCmd = state.plan?.verifyCmd;
  if (!verifyCmd) throw new Error("cannot verify sprint: no verifyCmd in plan");
  const sprint = (state.plan?.sprints ?? []).find((s) => s.id === sprintId);
  if (!sprint || sprint.status !== "in-progress") throw new Error(`sprint ${sprintId} is not in-progress (start it first)`);
  return recordEvidence({ runDir: dir, gateId: sprintGateId(sprintId), sprintId, command: verifyCmd, cwd, now });
}

export function bindCodexSession({ runDir: dir, sprintId, sessionId, transcriptPath, now }) {
  const state = readState(dir);
  const sprint = (state.plan?.sprints ?? []).find((s) => s.id === sprintId);
  if (!sprint) throw new Error(`unknown sprint: ${sprintId}`);
  sprint.codexSessions = sprint.codexSessions ?? [];
  sprint.codexSessions.push({ sessionId, transcriptPath: transcriptPath ?? null, at: nowIso(now) });
  writeState(dir, state);
  appendLedger(dir, { at: nowIso(now), type: "codex-bound", sprintId, sessionId });
  return state;
}

export function finishSprint({ runDir: dir, sprintId, now }) {
  const state = readState(dir);
  const gate = state.gates[sprintGateId(sprintId)];
  if (!gate || gate.status !== "evidence-passed") {
    throw new Error(`sprint ${sprintId} not verified (verifyCmd has not passed)`);
  }
  const sprint = (state.plan?.sprints ?? []).find((s) => s.id === sprintId);
  if (!sprint) throw new Error(`unknown sprint: ${sprintId}`);
  sprint.status = "done";
  writeState(dir, state);
  appendLedger(dir, { at: nowIso(now), type: "sprint-done", sprintId });
  return state;
}
