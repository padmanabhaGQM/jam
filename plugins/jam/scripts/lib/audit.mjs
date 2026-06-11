import fs from "node:fs";
import { readLedger } from "./ledger.mjs";
import { readState } from "./state.mjs";
import { repairPhaseOrder, greenfieldPhaseOrder, REQUIRED_GREENFIELD_GATES } from "./mode.mjs";
import { allSprintsDone } from "./sprint.mjs";   // run-honesty: a finished greenfield BUILD has all sprints done

const PRODUCING_REPAIR = { DIAGNOSE: "digest-rendered", VERIFY: "verification", PLAN: "plan-recorded" };
// NOTE: no BUILD entry — the BUILD->FINISH advance is audited AFTER it's written (advanceRun audits before
// advancePhase appends the ledger entry), so a BUILD producer check here would never fire (same as repair
// IMPLEMENT, which has no producer). BUILD->FINISH is gated by allSprintsDone + the BUILD-plan gate +
// the per-sprint authorship/evidence checks below. The GROUND/CONVERGE/SPECIFY producers ARE checked at
// the FINISH-time audit because their phase-advanced entries are already in the ledger.
const PRODUCING_GREENFIELD = { GROUND: "grounding-converged", CONVERGE: "convergence-decided", SPECIFY: "spec-certified" };
// These producing artifacts carry no gateId — match them by type only (as plan-recorded already is for repair PLAN).
const GATEID_AGNOSTIC = new Set(["plan-recorded", "grounding-converged", "convergence-decided", "spec-certified"]);
const SUBGATE_REARM_TYPES = {
  "BUILD-plan": "plan-recorded",
  "GROUND-scope": "intent-sharpened",
  "CONVERGE-shortlist": "shortlist-set",
  "SPECIFY-coverage": "coverage-set",
  ALIGN: "digest-rendered",
};
const SUBGATE_ID_AGNOSTIC_REARMS = new Set(["intent-sharpened", "shortlist-set", "coverage-set"]);

export function rearmTypeFor(gateId, PRODUCING, state = {}) {
  const producing = { ...PRODUCING, ...SUBGATE_REARM_TYPES }[gateId];
  if (producing) return producing;
  const g = state.gates?.[gateId];
  if (g && (g.approveFrom ?? "rendered") === "rendered") return "digest-rendered";
  return null;
}

export function evaluateAudit({ ledger = [], state = {}, transcriptExists }) {
  const failures = [];
  const greenfield = state.mode === "greenfield";
  const ORDER = greenfield ? greenfieldPhaseOrder : repairPhaseOrder;
  const PRODUCING = greenfield ? PRODUCING_GREENFIELD : PRODUCING_REPAIR;

  if (typeof state.phase === "string" && !ORDER.includes(state.phase)) {
    failures.push(`ordering: phase ${state.phase} is not a valid phase for this mode`);
  }

  let expectedFrom = ORDER[0];
  ledger.forEach((e, i) => {
    if (e.type !== "phase-advanced") return;
    if (ORDER.indexOf(e.to) !== ORDER.indexOf(e.from) + 1) {
      failures.push(`ordering: phase-advanced from ${e.from} to ${e.to} is not a valid step`);
    }
    if (e.from !== expectedFrom) {
      failures.push(`ordering: expected advance from ${expectedFrom} but got from ${e.from}`);
    } else {
      expectedFrom = e.to;
    }
    const producing = PRODUCING[e.from];
    if (producing) {
      const approvalIdx = ledger.findIndex((x, xi) => xi < i && x.type === "approval" && x.gateId === e.from);
      const producedIdx = ledger.findIndex((x, xi) =>
        xi < i &&
        x.type === producing &&
        (GATEID_AGNOSTIC.has(producing) ? true : x.gateId === e.from) &&
        (producing === "verification" ? x.blockers === 0 : true)
      );
      if (producedIdx === -1) failures.push(`ordering: advance from ${e.from} has no valid preceding ${producing}`);
      if (approvalIdx === -1) failures.push(`ordering: advance from ${e.from} has no preceding approval`);
      if (producedIdx !== -1 && approvalIdx !== -1 && producedIdx >= approvalIdx) {
        failures.push(`ordering: ${e.from} approval is not preceded by its ${producing}`);
      }
    }
  });

  if (greenfield) {
    ledger.forEach((e, i) => {
      if (e.type !== "phase-advanced") return;
      for (const gid of (REQUIRED_GREENFIELD_GATES[e.from] ?? [])) {
        const idx = ledger.findIndex((x, xi) => xi < i && x.type === "approval" && x.gateId === gid);
        if (idx === -1) failures.push(`ordering: greenfield phase ${e.from} advanced without a preceding approval for required gate ${gid}`);
      }
    });
  }

  // A gate approved after a rejection must have been re-produced between the rejection and the approval.
  ledger.forEach((e, i) => {
    if (e.type !== "approval") return;
    let lastRej = -1;
    ledger.forEach((x, xi) => { if (xi < i && x.type === "gate-rejected" && x.gateId === e.gateId) lastRej = xi; });
    if (lastRej === -1) return;
    const producing = rearmTypeFor(e.gateId, PRODUCING, state);
    if (!producing) {
      failures.push(`ordering: gate ${e.gateId} approved after a rejection with no known re-arm artifact`);
      return;
    }
    const reproduced = ledger.some((x, xi) => xi > lastRej && xi < i && x.type === producing &&
      (GATEID_AGNOSTIC.has(producing) || SUBGATE_ID_AGNOSTIC_REARMS.has(producing) ? true : x.gateId === e.gateId) &&
      (producing === "verification" ? x.blockers === 0 : true));
    if (!reproduced) failures.push(`ordering: gate ${e.gateId} approved after being rejected without re-producing its artifact`);
  });

  // BUILD's producer/approval is MANDATORY for any greenfield run at or past BUILD — keyed on PHASE, not on
  // gate presence, so a forged state that simply OMITS the BUILD-plan gate cannot slip past this check.
  const phaseIdx = ORDER.indexOf(state.phase);
  if (greenfield && phaseIdx >= ORDER.indexOf("BUILD")) {
    const gateOk = state.gates && state.gates["BUILD-plan"] && state.gates["BUILD-plan"].status === "approved";
    if (!gateOk) failures.push("ordering: greenfield BUILD requires an approved BUILD-plan gate");
    const apprIdx = ledger.findIndex((x) => x.type === "approval" && x.gateId === "BUILD-plan");
    const planIdx = ledger.findIndex((x) => x.type === "plan-recorded");
    const cert = [...ledger].reverse().find((x) => x.type === "spec-certified");
    if (cert && typeof cert.verifyCmd === "string" && state.spec && cert.verifyCmd !== state.spec.verifyCmd) {
      failures.push("ordering: state.spec.verifyCmd does not match the certified verifyCmd in the ledger");
    }
    if (planIdx === -1) failures.push("ordering: greenfield BUILD requires plan-recorded in the ledger");
    if (apprIdx === -1) failures.push("ordering: greenfield BUILD requires a BUILD-plan approval entry");
    else if (planIdx !== -1 && planIdx >= apprIdx) failures.push("ordering: BUILD-plan approval is not preceded by plan-recorded");
    // If BUILD->FINISH has already been recorded (a completed run audited via `jam audit`), both the
    // plan-recorded AND its approval must PRECEDE that advance — a forged ledger cannot advance first
    // and back-fill the plan afterward.
    const finishIdx = ledger.findIndex((x) => x.type === "phase-advanced" && x.from === "BUILD" && x.to === "FINISH");
    if (finishIdx !== -1) {
      if (planIdx === -1 || planIdx >= finishIdx) failures.push("ordering: BUILD->FINISH advanced without a preceding plan-recorded");
      if (apprIdx === -1 || apprIdx >= finishIdx) failures.push("ordering: BUILD->FINISH advanced without a preceding BUILD-plan approval");
    }
    // A finished greenfield BUILD (BUILD->FINISH recorded, or the run is already at FINISH) must have ALL
    // build sprints done — the standalone `jam audit` must be as strict as the live advanceRun's allSprintsDone.
    if ((finishIdx !== -1 || state.phase === "FINISH") && !allSprintsDone(state)) {
      failures.push("ordering: greenfield BUILD->FINISH requires all build sprints done");
    }
    let lastBuildApprIdx = -1;
    ledger.forEach((x, xi) => { if (x.type === "approval" && x.gateId === "BUILD-plan") lastBuildApprIdx = xi; });
    if (lastBuildApprIdx !== -1) {
      ledger.forEach((x, xi) => {
        if (x.type === "sprint-started" && xi < lastBuildApprIdx) {
          failures.push(`ordering: sprint ${x.sprintId} started before the BUILD-plan was approved`);
        }
      });
    }
    if (lastBuildApprIdx !== -1) {
      const mutatedAfter = ledger.findIndex((x, xi) => xi > lastBuildApprIdx && x.type === "plan-recorded");
      if (mutatedAfter !== -1) failures.push("ordering: build plan was re-recorded after its BUILD-plan approval without re-approval");
    }
    let approvedPlan = null;
    ledger.forEach((x, xi) => { if (x.type === "plan-recorded" && (lastBuildApprIdx === -1 || xi <= lastBuildApprIdx)) approvedPlan = x; });
    if (approvedPlan && Array.isArray(approvedPlan.sprintIds)) {
      const approvedSet = new Set(approvedPlan.sprintIds);
      const stateSprints = state.plan?.sprints ?? [];
      const stateIds = stateSprints.map((s) => s.id);
      for (const id of approvedPlan.sprintIds) {
        if (!stateIds.includes(id)) failures.push(`consistency: approved build sprint ${id} is missing from state.plan`);
      }
      for (const sp of stateSprints) {
        if (sp.provenance === "planned" && !approvedSet.has(sp.id)) {
          failures.push(`consistency: state.plan has planned sprint ${sp.id} not in the approved build plan`);
        }
      }
    }
  }

  if (greenfield && typeof state.phase === "string" && ORDER.includes(state.phase) && expectedFrom !== state.phase) {
    failures.push(`ordering: greenfield phase history is incomplete — the ledger only advanced to ${expectedFrom}, but the run is at ${state.phase} (a phase was skipped or its advance is missing)`);
  }

  // Only a FINISHED run is required to carry a fresh final-verification. The LIVE transition is gated by
  // advanceRun's own re-verify (which appends the entry before advancing); a standalone `jam audit` at
  // IMPLEMENT/BUILD with all sprints done must NOT require it (the run hasn't advanced yet).
  if (state.phase === "FINISH") {
    let lastSprintDone = -1;
    ledger.forEach((e, i) => { if (e.type === "sprint-done") lastSprintDone = i; });
    const finalOk = ledger.some((e, i) => e.type === "final-verification" && e.exitCode === 0 && i > lastSprintDone);
    if (!finalOk) failures.push("evidence: FINISH requires a final-verification (verifyCmd exit 0) recorded after the last sprint");
    for (const [gid, g] of Object.entries(state.gates ?? {})) {
      if (g.status !== "rejected") continue;
      if (gid.startsWith("action-") && (state.actions ?? []).some((a) => a.id === gid.slice("action-".length) && a.status === "denied")) continue;
      failures.push(`governance: gate ${gid} is rejected — a finished run cannot carry an open rejection`);
    }
  }

  const sprints = state.plan?.sprints ?? [];
  ledger.forEach((e, d) => {
    if (e.type !== "sprint-done") return;
    const S = e.sprintId;
    const boundIdx = ledger.findIndex((x, xi) => xi < d && x.type === "codex-bound" && x.sprintId === S);
    const startedIdx = ledger.findIndex((x, xi) => xi < d && x.type === "sprint-started" && x.sprintId === S);
    if (boundIdx === -1) failures.push(`authorship: sprint-done ${S} has no preceding codex-bound`);
    else if (startedIdx !== -1 && boundIdx < startedIdx) failures.push(`ordering: sprint ${S} was bound before it was started`);
    if (startedIdx === -1) failures.push(`ordering: sprint-done ${S} has no preceding sprint-started`);
    const sprint = sprints.find((s) => s.id === S);
    const transcriptOk = (sprint?.codexSessions ?? []).some((s) => transcriptExists(s.transcriptPath));
    if (!transcriptOk) failures.push(`authorship: sprint ${S} has no bound session with an existing transcript`);
    let evIdx = -1;
    ledger.forEach((x, xi) => { if (xi < d && x.type === "evidence" && x.sprintId === S && x.gateId === `sprint-${S}` && x.exitCode === 0) evIdx = xi; });
    if (evIdx === -1) failures.push(`evidence: sprint-done ${S} has no preceding passing evidence (exit 0)`);
    else if (startedIdx !== -1 && startedIdx > evIdx) failures.push(`ordering: sprint ${S} evidence was recorded before it was started`);
    // The LAST isolated turn opened before this sprint-done must have been reconciled UNDER ITS OWN TOKEN
    // before the done (a reconciled s1#1 must not satisfy an open/unreconciled s1#2).
    let lastOpen = null, lastOpenIdx = -1;
    ledger.forEach((x, xi) => { if (xi < d && x.type === "turn-opened" && x.sprintId === S && x.isolated !== false) { lastOpen = x; lastOpenIdx = xi; } });
    if (lastOpen) {
      const reconciledIdx = ledger.findIndex((x, xi) => xi > lastOpenIdx && xi < d && x.type === "turn-reconciled" && x.sprintId === S && x.token === lastOpen.token);
      if (reconciledIdx === -1) failures.push(`ordering: sprint-done ${S} not preceded by a turn-reconciled for the live turn ${lastOpen.token}`);
      else if (evIdx !== -1 && evIdx <= reconciledIdx) failures.push(`evidence: sprint-done ${S} evidence predates the reconciled turn — re-verify after reconcile`);
    }
  });

  for (const sp of sprints) {
    if (sp.status === "done" && !ledger.some((x) => x.type === "sprint-done" && x.sprintId === sp.id)) {
      failures.push(`consistency: sprint ${sp.id} is done in state but has no sprint-done ledger entry`);
    }
  }

  const promotions = state.promotions ?? [];
  for (const sp of sprints) {
    if (sp.status === "in-progress" || sp.status === "done") {
      if (!["planned", "promoted"].includes(sp.provenance)) {
        failures.push(`provenance: sprint ${sp.id} is ${sp.status} but has no valid provenance`);
      } else if (sp.provenance === "promoted") {
        if (!promotions.some((p) => p.id === sp.id)) failures.push(`provenance: promoted sprint ${sp.id} has no promotion decision`);
        const promIdx = ledger.findIndex((x) => x.type === "sprint-promoted" && x.id === sp.id);
        if (promIdx === -1) {
          failures.push(`provenance: promoted sprint ${sp.id} has no sprint-promoted ledger entry`);
        } else {
          const stIdx = ledger.findIndex((x) => x.type === "sprint-started" && x.sprintId === sp.id);
          const dnIdx = ledger.findIndex((x) => x.type === "sprint-done" && x.sprintId === sp.id);
          if (stIdx !== -1 && promIdx > stIdx) failures.push(`ordering: promoted sprint ${sp.id} was started before it was promoted`);
          if (dnIdx !== -1 && promIdx > dnIdx) failures.push(`ordering: promoted sprint ${sp.id} was done before it was promoted`);
        }
      }
    }
  }

  const byId = new Map(sprints.map((s) => [s.id, s]));
  ledger.forEach((e, i) => {
    if (e.type !== "sprint-started") return;
    const sp = byId.get(e.sprintId);
    for (const dep of sp?.needs ?? []) {
      const depDone = ledger.findIndex((x, xi) => xi < i && x.type === "sprint-done" && x.sprintId === dep);
      if (depDone === -1) failures.push(`ordering: sprint ${e.sprintId} started before its dependency ${dep} was done`);
    }
  });

  for (const a of state.actions ?? []) {
    if (a.irreversible && a.status === "proposed") {
      failures.push(`governance: irreversible action ${a.id} is undecided — ratify or deny before FINISH`);
    }
  }

  return { ok: failures.length === 0, failures };
}

export function auditRun({ runDir }) {
  const ledger = readLedger(runDir);
  const state = readState(runDir);
  return evaluateAudit({ ledger, state, transcriptExists: (p) => !!p && fs.existsSync(p) });
}
