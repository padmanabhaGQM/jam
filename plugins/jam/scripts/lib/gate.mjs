import { getGate } from "./state.mjs";

export function producerHint(gateId, need, state) {
  const id = gateId.replace(/^action-/, "");
  if (need === "evidence-passed") {
    const sprintId = gateId.startsWith("sprint-") ? gateId.slice("sprint-".length) : null;
    const isPlanSprint = sprintId && (state?.plan?.sprints ?? []).some((s) => s.id === sprintId);
    return isPlanSprint
      ? `jam sprint ${sprintId} --verify`
      : `jam evidence ${gateId} --sprint <id> --cmd "<command>"`;
  }
  const map = {
    rendered: `jam render-digest ${gateId} --file <digest.json>`,
    verified: "jam verify --file <verdict.json>",
    planned: gateId === "BUILD-plan" ? "jam build plan --file <plan.json>" : "jam plan --file <plan.json>",
    ratified: `jam ratify ${id} --confirm ${id}`,
    scoped: "jam ground sharpen --file <scope.json>",
    grounded: "jam ground converge --file <grounding.json>",
    shortlisted: "jam converge shortlist --file <shortlist.json>",
    contested: "jam converge tiebreak --choose <option>",
    decided: "jam converge finalize --file <decision.json>",
    covered: "jam specify coverage --file <coverage.json>",
    specified: "jam specify certify",
  };
  return map[need] ?? null;
}

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
        : { allowed: false, reason: `gate ${gateId}: awaiting verified evidence (status=${g.status}) — produce it: ${producerHint(gateId, "evidence-passed", state)}` };
    case "human":
      if (g.status === "rejected") {
        const rear = producerHint(gateId, g.approveFrom ?? "rendered", state);
        return { allowed: false, reason: `gate ${gateId}: rejected: ${g.rejectedReason ?? "(no reason)"} — re-produce its artifact${rear ? ` (${rear})` : ""}, then approve` };
      }
      if (g.status === "approved") return { allowed: true, reason: `gate ${gateId}: human approved` };
      if (g.approveFrom === "ratified" && g.status === "ratified") return { allowed: true, reason: `gate ${gateId}: ratified (human authorization recorded)` };
      if (g.approveFrom === "contested" && g.status === "contested") {
        return { allowed: false, reason: `gate ${gateId}: ready for ruling — rule the tiebreak: jam converge tiebreak --choose <option>` };
      }
      if (g.status === (g.approveFrom ?? "rendered")) {
        return { allowed: false, reason: `gate ${gateId}: ready for approval — approve: jam approve ${gateId}` };
      }
      {
        const need = g.approveFrom ?? "rendered";
        const hint = producerHint(gateId, need, state);
        return { allowed: false, reason: `gate ${gateId}: awaiting ${need} (status=${g.status})${hint ? ` — produce it: ${hint}` : ""}` };
      }
    case "show-and-proceed": {
      const ok = ["rendered", "approved", "evidence-passed"];
      if (g.approveFrom && !ok.includes(g.approveFrom)) ok.push(g.approveFrom);
      return ok.includes(g.status)
        ? { allowed: true, reason: `gate ${gateId}: artifact produced (show-and-proceed)` }
        : { allowed: false, reason: `gate ${gateId}: awaiting its artifact (status=${g.status}, needs ${g.approveFrom ?? "rendered"}) — produce it: ${producerHint(gateId, g.approveFrom ?? "rendered", state)}` };
    }
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
