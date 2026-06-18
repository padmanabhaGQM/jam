import fs from "node:fs";
import { readLedger } from "./ledger.mjs";
import { readState, statePath } from "./state.mjs";
import { auditRun } from "./audit.mjs";

function ts(e) { const t = e && e.at ? Date.parse(e.at) : NaN; return Number.isFinite(t) ? t : null; }

export function evaluateReport({ ledger = [], state = {}, auditResult = null }) {
  // LAST run-created: legacy ledgers (r1) hold several run-created entries from re-used run ids;
  // the state represents the latest run, so wall time anchors on the latest creation.
  const created = [...ledger].reverse().find((e) => e.type === "run-created") ?? null;
  const stamps = ledger.map(ts).filter((t) => t !== null);
  const createdAt = created ? created.at ?? null : null;
  const wallMs = (ts(created) !== null && stamps.length) ? Math.max(...stamps) - ts(created) : null;

  const advances = ledger.filter((e) => e.type === "phase-advanced");
  const phases = advances.map((e, i) => {
    const a = ts(e), b = i + 1 < advances.length ? ts(advances[i + 1]) : null;
    return { from: e.from ?? null, to: e.to ?? null, at: e.at ?? null, dwellMs: a !== null && b !== null ? b - a : null };
  });

  const verifications = ledger.filter((e) => e.type === "verification").map((e) => ({ gateId: e.gateId ?? null, at: e.at ?? null, blockers: e.blockers ?? null }));
  const rounds = ledger.filter((e) => e.type === "review-round").map((e) => ({ phase: e.phase, round: e.round, blockers: e.blockers, notes: e.notes, at: e.at ?? null }));
  const firstZero = (phase) => { const hit = rounds.filter((r) => r.phase === phase && r.blockers === 0).map((r) => r.round); return hit.length ? Math.min(...hit) : null; };
  const reviews = {
    verifications, rounds,
    roundsToZero: { VERIFY: firstZero("VERIFY"), SLICE: firstZero("SLICE") },
    roundDataMissing: verifications.length > 0 && rounds.length === 0,
  };

  const planSprints = state.plan?.sprints ?? [];
  const sprints = planSprints.map((sp) => {
    const started = [...ledger].reverse().find((e) => e.type === "sprint-started" && e.sprintId === sp.id) ?? null;
    const done = [...ledger].reverse().find((e) => e.type === "sprint-done" && e.sprintId === sp.id) ?? null;
    const a = ts(started), b = ts(done);
    const ev = [...ledger].reverse().find((e) => e.type === "evidence" && e.sprintId === sp.id && e.gateId === `sprint-${sp.id}`) ?? null;
    const turnEvents = ledger.filter((e) => typeof e.type === "string" && e.type.startsWith("turn-") && e.sprintId === sp.id);
    const scopeStripped = turnEvents.filter((e) => e.type === "turn-scope-stripped").length;
    const turn = turnEvents.length === 0 ? null : {
      opened: turnEvents.filter((e) => e.type === "turn-opened").length,
      reconciled: turnEvents.filter((e) => e.type === "turn-reconciled").length,
      discarded: turnEvents.filter((e) => e.type === "turn-discarded").length,
      unisolated: turnEvents.filter((e) => e.type === "turn-unisolated").length,
      ...(scopeStripped ? { scopeStripped } : {}),
    };
    return {
      id: sp.id, title: sp.title ?? null, provenance: sp.provenance ?? null,
      startedAt: started?.at ?? null, doneAt: done?.at ?? null,
      durationMs: a !== null && b !== null ? b - a : null,
      bound: (sp.codexSessions ?? []).length > 0,
      transcriptRecorded: (sp.codexSessions ?? []).some((s) => !!s.transcriptPath),
      evidenceExit: ev ? ev.exitCode ?? null : null,
      turn,
    };
  });
  const allTurn = (k) => ledger.filter((e) => e.type === `turn-${k}`).length;
  const totals = {
    sprints: sprints.length,
    done: sprints.filter((s) => planSprints.find((p) => p.id === s.id)?.status === "done").length,
    totalSprintMs: sprints.reduce((acc, s) => (s.durationMs !== null ? (acc ?? 0) + s.durationMs : acc), null),
    turnsOpened: allTurn("opened"), turnsReconciled: allTurn("reconciled"),
    turnsDiscarded: allTurn("discarded"), turnsUnisolated: allTurn("unisolated"),
  };

  const fin = [...ledger].reverse().find((e) => e.type === "final-verification") ?? null;
  const finalVerification = fin
    ? { present: true, at: fin.at ?? null, command: fin.command ?? null, exitCode: fin.exitCode ?? null }
    : { present: false };
  const finishFin = [...ledger].reverse().find((e) => e.type === "final-finish-verification") ?? null;
  const finishVerification = finishFin
    ? { present: true, at: finishFin.at ?? null, command: finishFin.command ?? null, exitCode: finishFin.exitCode ?? null }
    : { present: false };
  const plan = {
    verifyCmd: state.plan?.verifyCmd ?? null,
    finishCmd: state.plan?.finishCmd ?? null,
  };

  return {
    run: { runId: state.runId ?? created?.runId ?? null, mode: state.mode ?? "repair", phase: state.phase ?? null,
           topic: state.topic ?? created?.topic ?? null, goalSet: ledger.some((e) => e.type === "goal-set"),
           createdAt, lastEventAt: stamps.length ? new Date(Math.max(...stamps)).toISOString() : null, wallMs },
    phases, reviews, sprints, totals, plan, finalVerification, finishVerification,
    audit: auditResult,
  };
}

function fmtMs(ms) {
  if (ms === null || ms === undefined) return "?";
  const s = Math.round(ms / 1000), m = Math.floor(s / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : m > 0 ? `${m}m ${String(s % 60).padStart(2, "0")}s` : `${s}s`;
}

export function renderReport(r) {
  const L = [];
  L.push(`run ${r.run.runId ?? "?"} — ${r.run.mode} — ${r.run.phase ?? "?"}`);
  L.push(`  wall: ${fmtMs(r.run.wallMs)}   created: ${r.run.createdAt ?? "?"}`);
  if (r.plan?.verifyCmd || r.plan?.finishCmd) {
    L.push(`  plan: verify ${r.plan.verifyCmd ?? "—"}${r.plan.finishCmd ? ` · finish ${r.plan.finishCmd}` : ""}`);
  }
  // dwellMs belongs to the phase ENTERED (p.to): time from this advance to the next one.
  if (r.phases.length) L.push(`  phases: ${r.phases[0].from} → ${r.phases.map((p) => p.dwellMs !== null ? `${p.to} ${fmtMs(p.dwellMs)}` : `${p.to}`).join(" → ")}`);
  const rv = [];
  for (const phase of ["VERIFY", "SLICE"]) {
    const ph = r.reviews.rounds.filter((x) => x.phase === phase);
    if (ph.length) rv.push(`${phase} ${ph.length} rounds (rounds to zero: ${r.reviews.roundsToZero[phase] ?? "—"})`);
  }
  if (r.reviews.verifications.length) rv.push(`${r.reviews.verifications.length} verification(s), last blockers=${r.reviews.verifications[r.reviews.verifications.length - 1].blockers}`);
  if (rv.length) L.push(`  reviews: ${rv.join("; ")}${r.reviews.roundDataMissing ? "   (round-level review data not recorded for this run)" : ""}`);
  if (r.sprints.length) {
    L.push(`  sprints (${r.totals.done}/${r.totals.sprints} done${r.totals.totalSprintMs !== null ? `, ${fmtMs(r.totals.totalSprintMs)} total` : ""}):`);
    for (const s of r.sprints) {
      const turn = s.turn ? `  turn ${s.turn.reconciled ? "reconciled" : s.turn.unisolated ? "unisolated" : s.turn.discarded ? "discarded" : "open"}${s.turn.scopeStripped ? ` scope-stripped ${s.turn.scopeStripped}` : ""}` : "";
      L.push(`    ${s.id}  ${fmtMs(s.durationMs)}  codex-bound ${s.bound ? "✓" : "✗"} transcript ${s.transcriptRecorded ? "✓" : "✗"}  evidence exit ${s.evidenceExit ?? "—"}${turn}`);
    }
  }
  if (r.totals.turnsOpened) L.push(`  turns: ${r.totals.turnsOpened} opened, ${r.totals.turnsReconciled} reconciled, ${r.totals.turnsDiscarded} discarded, ${r.totals.turnsUnisolated} unisolated`);
  L.push(`  final-verification: ${r.finalVerification.present ? `✓ ${r.finalVerification.command ?? ""} exit ${r.finalVerification.exitCode}` : "—"}`);
  L.push(`  final-finish-verification: ${r.finishVerification.present ? `✓ ${r.finishVerification.command ?? ""} exit ${r.finishVerification.exitCode}` : "—"}`);
  L.push(`  audit: ${r.audit === null ? "—" : r.audit.error ? `(unavailable: ${r.audit.error})` : r.audit.ok ? "PASS" : `FAIL (${r.audit.failures.length})`}`);
  return L.join("\n") + "\n";
}

export function renderReportMd(rep, { runId, specs = [], plans = [] }) {
  const L = [`# jam run ${runId}`, "", "```", renderReport(rep).trimEnd(), "```", ""];
  if (specs.length || plans.length) {
    L.push("## Linked documents", "");
    for (const f of specs) L.push(`- spec: [[${f.replace(/\.md$/, "")}]]`);
    for (const f of plans) L.push(`- plan: [[${f.replace(/\.md$/, "")}]]`);
    L.push("");
  }
  L.push(`*Generated by \`jam report ${runId} --md\` from the run ledger — every number is a ledger fact.*`);
  return L.join("\n") + "\n";
}

export function reportRun({ runDir }) {
  let ledger;
  try { ledger = readLedger(runDir); }
  catch (e) { return { error: `unreadable run: ${String(e && e.message)}` }; }
  // readState VALIDATES and throws on an invalid state — but observability must not be blocked by the
  // thing it observes. Fall back to a RAW parse for reporting; the audit then reports as unavailable.
  let state;
  try { state = readState(runDir); }
  catch {
    try { state = JSON.parse(fs.readFileSync(statePath(runDir), "utf8")); }
    catch (e2) { return { error: `unreadable run: ${String(e2 && e2.message)}` }; }
  }
  let auditResult;
  try { auditResult = auditRun({ runDir }); }
  catch (e) { auditResult = { ok: false, failures: [], error: String(e && e.message) }; }
  return evaluateReport({ ledger, state, auditResult });
}
