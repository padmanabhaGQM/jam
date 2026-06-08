import fs from "node:fs";
import path from "node:path";

import { createInitialState, readState, writeState, getGate, addGate as addGateToState } from "./state.mjs";
import { appendLedger } from "./ledger.mjs";
import { runVerification, captureEvidence } from "./evidence.mjs";
import { validateDigest } from "./digest.mjs";
import { runDir, runsRoot, activePointerPath } from "./paths.mjs";

function nowIso(now) {
  return now ?? new Date().toISOString();
}

export function createRun({ projectRoot, runId, topic, now, mode }) {
  const dir = runDir(projectRoot, runId);
  fs.mkdirSync(dir, { recursive: true });
  const state = createInitialState({ runId, topic, now: nowIso(now), mode });
  writeState(dir, state);
  fs.writeFileSync(activePointerPath(projectRoot), runId);
  appendLedger(dir, { at: nowIso(now), type: "run-created", runId, topic: topic ?? "", mode: mode ?? "greenfield" });
  return dir;
}

export function addGate({ runDir: dir, gateId, mode, now }) {
  const state = readState(dir);
  addGateToState(state, gateId, mode);
  writeState(dir, state);
  appendLedger(dir, { at: nowIso(now), type: "gate-added", gateId, mode });
  return state;
}

export function recordDigest({ runDir: dir, gateId, digest, now }) {
  const { valid, errors } = validateDigest(digest);
  if (!valid) throw new Error(`invalid digest: ${errors.join("; ")}`);
  const state = readState(dir);
  const g = getGate(state, gateId);
  const digDir = path.join(dir, "digests");
  fs.mkdirSync(digDir, { recursive: true });
  fs.writeFileSync(path.join(digDir, `${gateId}.json`), JSON.stringify(digest, null, 2));
  g.status = "rendered";
  writeState(dir, state);
  appendLedger(dir, { at: nowIso(now), type: "digest-rendered", gateId });
  return state;
}

export function recordApproval({ runDir: dir, gateId, who, now }) {
  const state = readState(dir);
  const g = getGate(state, gateId);
  if (g.mode !== "human") {
    throw new Error(`cannot approve gate ${gateId}: approval applies only to human gates (mode=${g.mode})`);
  }
  if (!["rendered", "verified"].includes(g.status)) {
    throw new Error(`cannot approve gate ${gateId}: digest not rendered / not verified yet (status=${g.status})`);
  }
  g.status = "approved";
  g.approvedBy = who ?? "user";
  g.approvedAt = nowIso(now);
  writeState(dir, state);
  appendLedger(dir, { at: g.approvedAt, type: "approval", gateId, who: g.approvedBy });
  return state;
}

export function recordEvidence({ runDir: dir, gateId, sprintId, command, cwd, now }) {
  const state = readState(dir);
  const g = getGate(state, gateId);
  if (g.mode !== "auto") {
    throw new Error(`cannot record evidence for gate ${gateId}: evidence applies only to auto gates (mode=${g.mode})`);
  }
  const result = runVerification(command, cwd);
  captureEvidence(dir, sprintId, { ...result, at: nowIso(now), gateId });
  if (result.exitCode === 0) {
    g.status = "evidence-passed";
    g.evidenceRef = `evidence/${sprintId}.json`;
  } else if (g.status === "evidence-passed") {
    g.status = "pending";
    g.evidenceRef = null;
  }
  writeState(dir, state);
  appendLedger(dir, { at: nowIso(now), type: "evidence", gateId, sprintId, exitCode: result.exitCode });
  return { state, result };
}
