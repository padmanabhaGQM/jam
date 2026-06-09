import fs from "node:fs";
import { readLedger } from "./ledger.mjs";
import { readState } from "./state.mjs";

const ORDER = ["DIAGNOSE", "VERIFY", "PLAN", "IMPLEMENT", "FINISH"];
const PRODUCING = { DIAGNOSE: "digest-rendered", VERIFY: "verification", PLAN: "plan-recorded" };

export function evaluateAudit({ ledger = [], state = {}, transcriptExists }) {
  const failures = [];

  let expectedFrom = "DIAGNOSE";
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
        (producing === "plan-recorded" ? true : x.gateId === e.from) &&
        (producing === "verification" ? x.blockers === 0 : true)
      );
      if (producedIdx === -1) failures.push(`ordering: advance from ${e.from} has no valid preceding ${producing}`);
      if (approvalIdx === -1) failures.push(`ordering: advance from ${e.from} has no preceding approval`);
      if (producedIdx !== -1 && approvalIdx !== -1 && producedIdx >= approvalIdx) {
        failures.push(`ordering: ${e.from} approval is not preceded by its ${producing}`);
      }
    }
  });

  const sprints = state.plan?.sprints ?? [];
  ledger.forEach((e, d) => {
    if (e.type !== "sprint-done") return;
    const S = e.sprintId;
    const boundIdx = ledger.findIndex((x, xi) => xi < d && x.type === "codex-bound" && x.sprintId === S);
    if (boundIdx === -1) failures.push(`authorship: sprint-done ${S} has no preceding codex-bound`);
    const sprint = sprints.find((s) => s.id === S);
    const transcriptOk = (sprint?.codexSessions ?? []).some((s) => transcriptExists(s.transcriptPath));
    if (!transcriptOk) failures.push(`authorship: sprint ${S} has no bound session with an existing transcript`);
    const evIdx = ledger.findIndex((x, xi) => xi < d && x.type === "evidence" && x.sprintId === S && x.gateId === `sprint-${S}` && x.exitCode === 0);
    if (evIdx === -1) failures.push(`evidence: sprint-done ${S} has no preceding passing evidence (exit 0)`);
  });

  return { ok: failures.length === 0, failures };
}

export function auditRun({ runDir }) {
  const ledger = readLedger(runDir);
  const state = readState(runDir);
  return evaluateAudit({ ledger, state, transcriptExists: (p) => !!p && fs.existsSync(p) });
}
