import fs from "node:fs";
import path from "node:path";
import { readState, writeState, addGate } from "./state.mjs";
import { recordEvidence } from "./actions.mjs";
import { appendLedger } from "./ledger.mjs";
import { locateTranscript, transcriptMatchesSession } from "./codex/session.mjs";
import { evaluateGate } from "./gate.mjs";

function nowIso(now) { return now ?? new Date().toISOString(); }
function sprintGateId(id) { return `sprint-${id}`; }

export function allSprintsDone(state) {
  const sprints = state.plan?.sprints ?? [];
  return sprints.length > 0 && sprints.every((s) => s.status === "done");
}

export function startSprint({ runDir: dir, sprintId, now }) {
  const state = readState(dir);
  if (state.phase !== "IMPLEMENT" && !(state.mode === "greenfield" && state.phase === "BUILD")) {
    throw new Error(`cannot start a sprint: phase is ${state.phase}, not IMPLEMENT (or greenfield BUILD)`);
  }
  if (state.mode === "greenfield" && state.phase === "BUILD" && !evaluateGate(state, "BUILD-plan").allowed) {
    throw new Error(`cannot start a sprint: the BUILD-plan gate must be approved first (the human gates the sprint breakdown)`);
  }
  const sprint = (state.plan?.sprints ?? []).find((s) => s.id === sprintId);
  if (!sprint) throw new Error(`unknown sprint: ${sprintId}`);
  if (sprint.status !== "pending") throw new Error(`sprint ${sprintId} is ${sprint.status}, not pending`);
  if (!["planned", "promoted"].includes(sprint.provenance)) {
    throw new Error(`sprint ${sprintId} has no valid provenance (planned|promoted) — scope must be planned or promoted`);
  }
  const allSprints = state.plan?.sprints ?? [];
  const unmet = (sprint.needs ?? []).filter((n) => {
    const dep = allSprints.find((s) => s.id === n);
    return !dep || dep.status !== "done";
  });
  if (unmet.length) throw new Error(`sprint ${sprintId} blocked: needs ${unmet.join(", ")} (not done)`);
  sprint.status = "in-progress";
  addGate(state, sprintGateId(sprintId), "auto");
  writeState(dir, state);
  appendLedger(dir, { at: nowIso(now), type: "sprint-started", sprintId });
  return state;
}

// LOW-LEVEL: bumps turnSeq and OVERWRITES sprint.turn. It does NOT clean up a prior open turn's worktree —
// the caller (cmdCodexRun) must mark any prior open turn discarded + push its worktree to abandonedWorktrees
// BEFORE calling openTurn (it does). Direct callers in non-CLI contexts must do the same.
export function openTurn({ runDir: dir, sprintId, worktreePath, baselineRef, isolated = true, now }) {
  const state = readState(dir);
  const sprint = (state.plan?.sprints ?? []).find((s) => s.id === sprintId);
  if (!sprint) throw new Error(`unknown sprint: ${sprintId}`);
  if (sprint.status !== "in-progress") throw new Error(`sprint ${sprintId} is not in-progress (start it first)`);
  sprint.turnSeq = (sprint.turnSeq ?? 0) + 1;
  const token = `${sprintId}#${sprint.turnSeq}`;
  sprint.turn = { token, worktreePath: worktreePath ?? null, baselineRef: baselineRef ?? null, sessionId: null, status: "open", isolated };
  writeState(dir, state);
  appendLedger(dir, { at: nowIso(now), type: "turn-opened", sprintId, token, baselineRef: baselineRef ?? null, isolated });
  return { token };
}

export function verifySprint({ runDir: dir, sprintId, cwd, now }) {
  const state = readState(dir);
  const verifyCmd = state.plan?.verifyCmd;
  if (!verifyCmd) throw new Error("cannot verify sprint: no verifyCmd in plan");
  const sprint = (state.plan?.sprints ?? []).find((s) => s.id === sprintId);
  if (!sprint || sprint.status !== "in-progress") throw new Error(`sprint ${sprintId} is not in-progress (start it first)`);
  if (sprint.turn && sprint.turn.status === "open" && sprint.turn.isolated !== false) {
    throw new Error(`sprint ${sprintId} has an un-reconciled open turn (${sprint.turn.token}) — run 'jam reconcile --sprint ${sprintId}' first`);
  }
  return recordEvidence({ runDir: dir, gateId: sprintGateId(sprintId), sprintId, command: verifyCmd, cwd, now });
}

export function bindCodexSession({ runDir: dir, sprintId, sessionId, transcriptPath, codexHome, now }) {
  const state = readState(dir);
  const sprint = (state.plan?.sprints ?? []).find((s) => s.id === sprintId);
  if (!sprint) throw new Error(`unknown sprint: ${sprintId}`);
  if (sprint.status !== "in-progress") throw new Error(`sprint ${sprintId} is not in-progress (start it before binding a Codex session)`);
  const located = locateTranscript(sessionId, codexHome ? { codexHome } : undefined);
  if (transcriptPath && located && path.resolve(transcriptPath) !== path.resolve(located)) {
    throw new Error(`transcriptPath does not match the located Codex rollout for session ${sessionId}`);
  }
  // Content-bind: accept the located rollout only if its session_meta identifies THIS exact session.
  // (Filename substring matching alone is forgeable; this is bounded by who can write CODEX_HOME/sessions.)
  const verified = located && transcriptMatchesSession(located, sessionId) ? located : null;
  sprint.codexSessions = sprint.codexSessions ?? [];
  sprint.codexSessions.push({ sessionId, transcriptPath: verified, at: nowIso(now) });
  if (sprint.turn && sprint.turn.status === "open" && verified) sprint.turn.sessionId = sessionId;
  writeState(dir, state);
  appendLedger(dir, { at: nowIso(now), type: "codex-bound", sprintId, sessionId });
  return state;
}

export function finishSprint({ runDir: dir, sprintId, codexHome, now }) {
  const state = readState(dir);
  const sprint = (state.plan?.sprints ?? []).find((s) => s.id === sprintId);
  if (!sprint) throw new Error(`unknown sprint: ${sprintId}`);
  if (sprint.turn && sprint.turn.status === "open" && sprint.turn.isolated !== false) {
    throw new Error(`sprint ${sprintId} has an un-reconciled open turn (${sprint.turn.token}) — run 'jam reconcile --sprint ${sprintId}' first`);
  }
  const gate = state.gates[sprintGateId(sprintId)];
  if (!gate || gate.status !== "evidence-passed") {
    throw new Error(`sprint ${sprintId} not verified (verifyCmd has not passed)`);
  }
  // The stored transcriptPath is canonical-by-construction: bindCodexSession derives it from
  // locateTranscript(sessionId) and never trusts a caller-supplied path (a made-up session stores
  // null). Confirming the artifact still exists is therefore sufficient; re-locating here would
  // wrongly couple `--done` to CODEX_HOME pointing at the same place at finish time.
  const authored = (sprint.codexSessions ?? []).some((s) => !!s.transcriptPath && fs.existsSync(s.transcriptPath));
  if (!authored) {
    throw new Error(`sprint ${sprintId} has no Codex-authored session (a bound session with a locatable transcript) — implementation must come from Codex`);
  }
  sprint.status = "done";
  writeState(dir, state);
  appendLedger(dir, { at: nowIso(now), type: "sprint-done", sprintId });
  return state;
}
