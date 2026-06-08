import fs from "node:fs";
import path from "node:path";

import { readState, writeState, getGate } from "./state.mjs";
import { appendLedger } from "./ledger.mjs";
import { activePointerPath } from "./paths.mjs";

function nowIso(now) {
  return now ?? new Date().toISOString();
}

export function addSteering({ runDir: dir, text, context, now }) {
  if (!text || !text.trim()) throw new Error("addSteering: text required");
  const state = readState(dir);
  const id = `d${state.steeringDirectives.length + 1}`;
  const directive = { id, text, context: context ?? "", status: "active", createdAt: nowIso(now) };
  state.steeringDirectives.push(directive);
  writeState(dir, state);
  appendLedger(dir, { at: directive.createdAt, type: "steering", id, text });
  return directive;
}

export function cancelRun({ projectRoot, runDir: dir, now }) {
  const p = activePointerPath(projectRoot);
  if (fs.existsSync(p)) fs.rmSync(p);
  appendLedger(dir, { at: nowIso(now), type: "cancelled" });
  return true;
}

export function recordVerification({ runDir: dir, gateId, verdict, now }) {
  const state = readState(dir);
  const g = getGate(state, gateId);
  const verDir = path.join(dir, "verifications");
  fs.mkdirSync(verDir, { recursive: true });
  fs.writeFileSync(path.join(verDir, `${gateId}.json`), JSON.stringify(verdict ?? {}, null, 2));
  const blockers = typeof verdict?.unresolvedBlockers === "number"
    ? verdict.unresolvedBlockers
    : (Array.isArray(verdict?.findings) ? verdict.findings.filter((f) => f.severity === "blocker").length : 0);
  if (blockers === 0) g.status = "verified";
  writeState(dir, state);
  appendLedger(dir, { at: nowIso(now), type: "verification", gateId, blockers });
  return { state, blockers };
}
