import { evaluateGate, producerHint } from "./gate.mjs";
import { allSprintsDone } from "./sprint.mjs";

export function deriveNextAction(state) {
  // Sprint hints apply only in the sprint-execution phases; after a rewind to an earlier phase, stale
  // in-progress sprint state must not shadow the real next action.
  const inSprintPhase = state.phase === "IMPLEMENT" || state.phase === "BUILD";
  const sprints = inSprintPhase ? (state.plan?.sprints ?? []) : [];
  const open = sprints.find((sp) => sp.turn && sp.turn.status === "open" && sp.turn.isolated !== false);
  if (open) return { kind: "reconcile", message: `turn ${open.turn.token} awaits reconcile — run 'jam reconcile --sprint ${open.id}' (if Codex is still running, wait; it is never killed)` };
  const inprog = sprints.find((sp) => sp.status === "in-progress");
  if (inprog) {
    const g = state.gates?.[`sprint-${inprog.id}`];
    return g && g.status === "evidence-passed"
      ? { kind: "done", message: `finish it: jam sprint ${inprog.id} --done` }
      : { kind: "verify", message: `verify it: jam sprint ${inprog.id} --verify (or continue: jam codex-run --sprint ${inprog.id})` };
  }
  // Blocking gates BEFORE the all-sprints-done shortcut: after a rewind, sprints may all be done while a
  // re-armed gate is pending, so the gate is the real next action, not `advance`.
  // SCOPED resolver: terminal irreversible-action gates are never "approved" (denied => rejected,
  // ratified => ratified), yet they block nothing live. Skip them when their backing action is resolved.
  const blockingGate = (st) => {
    for (const gid of Object.keys(st.gates ?? {})) {
      if (gid.startsWith("action-")) {
        const act = (st.actions ?? []).find((a) => a.id === gid.slice("action-".length));
        if (act && act.status !== "proposed") continue;       // denied/ratified/allowed: resolved, not blocking
      }
      if (!evaluateGate(st, gid).allowed) return gid;
    }
    return null;
  };
  const gateId = blockingGate(state);
  if (!gateId && state.phase === "FINISH") return { kind: "complete", message: "run complete — see 'jam report'" };
  if (!gateId && (state.phase === "IMPLEMENT" || state.phase === "BUILD") && allSprintsDone(state)) {
    return { kind: "advance", message: "all sprints done — run 'jam advance' (re-runs the verifyCmd live)" };
  }
  if (gateId) {
    const g = state.gates[gateId];
    if (g.status === "rejected") {
      const order2 = state.mode === "greenfield" ? ["GROUND", "CONVERGE", "SPECIFY", "BUILD", "FINISH"] : ["DIAGNOSE", "VERIFY", "PLAN", "IMPLEMENT", "FINISH"];
      const gp = order2.find((p) => gateId === p || gateId.startsWith(p + "-"));
      const back = gp && order2.indexOf(gp) < order2.indexOf(state.phase) ? ` (it belongs to ${gp} — 'jam rewind ${gp} --confirm ${gp}' first)` : "";
      const rear = producerHint(gateId, g.approveFrom ?? "rendered", state);
      return { kind: "rejected", message: `gate ${gateId} was rejected: ${g.rejectedReason ?? "(no reason)"} — re-produce its artifact${rear ? ` (${rear})` : ""}, then approve${back}` };
    }
    if (g.approveFrom === "contested" && g.status === "contested") {
      return { kind: "rule", message: "rule the tiebreak: jam converge tiebreak --choose <option>" };
    }
    return g.status === (g.approveFrom ?? "rendered")
      ? { kind: "approve", message: `gate ${gateId} ready — approve it: jam approve ${gateId}` }
      : { kind: "produce", message: producerHint(gateId, g.approveFrom ?? "rendered", state) ?? `${evaluateGate(state, gateId).reason}` };
  }
  if (inSprintPhase && sprints.length && !allSprintsDone(state)) {
    const done = new Set(sprints.filter((s) => s.status === "done").map((s) => s.id));
    const next = sprints.find((s) => s.status === "pending" && (s.needs ?? []).every((n) => done.has(n)));
    if (next) return { kind: "start", message: `start the next sprint: jam sprint ${next.id} --start` };
  }
  return { kind: "idle", message: "no blocking gate — run 'jam status' / 'jam advance'" };
}
