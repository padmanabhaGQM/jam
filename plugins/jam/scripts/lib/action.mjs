import { readState, writeState, addGate } from "./state.mjs";
import { appendLedger } from "./ledger.mjs";
import { classifyAction } from "./reversibility.mjs";

function nowIso(now) { return now ?? new Date().toISOString(); }
function actionGateId(id) { return `action-${id}`; }

export function proposeAction({ runDir: dir, id, type, target, command, now }) {
  if (!id) throw new Error("propose-action requires an id");
  const state = readState(dir);
  state.actions = state.actions ?? [];
  if (state.actions.some((a) => a.id === id)) throw new Error(`action ${id} already exists`);
  const { irreversible, reasons } = classifyAction({ type, target, command });
  const at = nowIso(now);
  state.actions.push({
    id, type: type ?? null, target: target ?? null, command: command ?? null,
    irreversible, reasons, status: irreversible ? "proposed" : "allowed", at,
  });
  if (irreversible) addGate(state, actionGateId(id), "human", "ratified");
  writeState(dir, state);
  appendLedger(dir, { at, type: "action-proposed", id, irreversible });
  return { irreversible, reasons };
}

export function ratifyAction({ runDir: dir, id, confirm, deny, now }) {
  const state = readState(dir);
  const action = (state.actions ?? []).find((a) => a.id === id);
  if (!action) throw new Error(`unknown action: ${id}`);
  if (!action.irreversible) throw new Error(`action ${id} is reversible — no ratification needed`);
  const gate = state.gates[actionGateId(id)];
  if (!gate) throw new Error(`action ${id} has no ratification gate`);
  const at = nowIso(now);
  if (deny) {
    gate.status = "rejected";
    action.status = "denied";
    writeState(dir, state);
    appendLedger(dir, { at, type: "action-denied", id, who: "user" });
    return state;
  }
  if (confirm !== id) {
    throw new Error(`ratification phrase does not match (type the action id "${id}" to confirm)`);
  }
  gate.status = "ratified";
  action.status = "ratified";
  writeState(dir, state);
  appendLedger(dir, { at, type: "action-ratified", id, who: "user" });
  return state;
}
