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
  if (g.mode !== "human") {
    throw new Error(`cannot record verification for gate ${gateId}: verification applies only to human gates (mode=${g.mode})`);
  }
  const hasCount = typeof verdict?.unresolvedBlockers === "number";
  const hasFindings = Array.isArray(verdict?.findings);
  if (!verdict || (!hasCount && !hasFindings)) {
    throw new Error(`cannot record verification for gate ${gateId}: verdict must include unresolvedBlockers (number) or findings (array)`);
  }
  let blockers;
  if (hasCount) {
    if (!Number.isInteger(verdict.unresolvedBlockers) || verdict.unresolvedBlockers < 0) {
      throw new Error(`cannot record verification for gate ${gateId}: unresolvedBlockers must be a non-negative integer`);
    }
    blockers = verdict.unresolvedBlockers;
  } else {
    blockers = verdict.findings.filter((f) => f.severity === "blocker").length;
  }
  const verDir = path.join(dir, "verifications");
  fs.mkdirSync(verDir, { recursive: true });
  fs.writeFileSync(path.join(verDir, `${gateId}.json`), JSON.stringify(verdict, null, 2));
  if (blockers === 0) g.status = "verified";
  writeState(dir, state);
  appendLedger(dir, { at: nowIso(now), type: "verification", gateId, blockers });
  return { state, blockers };
}
