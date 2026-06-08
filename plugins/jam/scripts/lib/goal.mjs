import fs from "node:fs";
import path from "node:path";
import { readState, writeState } from "./state.mjs";
import { appendLedger } from "./ledger.mjs";

export function getGoal(dir) {
  const p = path.join(dir, "goal.md");
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null;
}

export function setGoal({ runDir: dir, text, source, now }) {
  if (!text || !text.trim()) throw new Error("setGoal: goal text required");
  fs.writeFileSync(path.join(dir, "goal.md"), text);
  const state = readState(dir);
  state.goalRef = "goal.md";
  state.goalSource = source ?? null;
  writeState(dir, state);
  appendLedger(dir, { at: now ?? new Date().toISOString(), type: "goal-set", source: source ?? null });
  return state;
}
