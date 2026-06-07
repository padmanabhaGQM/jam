import fs from "node:fs";

import { readState, writeState } from "./state.mjs";
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
