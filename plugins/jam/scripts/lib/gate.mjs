import { getGate } from "./state.mjs";

export function evaluateGate(state, gateId) {
  let g;
  try {
    g = getGate(state, gateId);
  } catch {
    return { allowed: false, reason: `unknown gate ${gateId}` };
  }

  switch (g.mode) {
    case "auto":
      return g.status === "evidence-passed"
        ? { allowed: true, reason: `gate ${gateId}: evidence verified` }
        : { allowed: false, reason: `gate ${gateId}: awaiting verified evidence (status=${g.status})` };
    case "human":
      if (g.status === "rejected") return { allowed: false, reason: `gate ${gateId}: rejected: ${g.rejectedReason ?? "(no reason)"} — re-produce its artifact, then approve` };
      return g.status === "approved"
        ? { allowed: true, reason: `gate ${gateId}: human approved` }
        : { allowed: false, reason: `gate ${gateId}: awaiting human approval — run /jam:approve ${gateId}` };
    case "show-and-proceed":
      return ["rendered", "approved", "evidence-passed"].includes(g.status)
        ? { allowed: true, reason: `gate ${gateId}: digest rendered` }
        : { allowed: false, reason: `gate ${gateId}: awaiting digest render` };
    default:
      return { allowed: false, reason: `gate ${gateId}: unknown mode ${g.mode}` };
  }
}

export function currentBlockingGate(state) {
  for (const gateId of Object.keys(state.gates)) {
    if (!evaluateGate(state, gateId).allowed) return gateId;
  }
  return null;
}
