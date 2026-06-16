#!/usr/bin/env node
/**
 * jam.mjs — the jam run-control CLI. Drives the deterministic control surface.
 * Project root = process.cwd(); active run = the ACTIVE pointer under it.
 */
import process from "node:process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

import { readActiveRunId, runsRoot, runDir } from "./lib/paths.mjs";
import { phaseOrderFor } from "./lib/mode.mjs";
import { codexStart, codexResume, codexWait } from "./lib/codex/exec.mjs";
import { classifyTurn, sessionIdFromEventLog, locateTranscript, hasTurnCompleted } from "./lib/codex/session.mjs";
import { isGitRepo, openTurnWorktree, reconcileTurnWorktree, discardTurnWorktree, gcWorktrees } from "./lib/worktree.mjs";
import { readState, writeState } from "./lib/state.mjs";
import { appendLedger } from "./lib/ledger.mjs";
import { createRun, addGate, recordDigest, recordApproval, recordEvidence } from "./lib/actions.mjs";
import { addSteering, cancelRun, recordVerification, rejectGate, rewindPhase, dialGate } from "./lib/control.mjs";
import { setGoal } from "./lib/goal.mjs";
import { sharpenIntent, addClaim, refuteClaim, convergeGrounding } from "./lib/grounding.mjs";
import { setShortlist, recordDecision, ruleTiebreak, convergeDecision } from "./lib/convergence.mjs";
import { setCoverage, recordRedProof, recordGameability, certifyVerifyCmd } from "./lib/spec.mjs";
import { recordBuildPlan } from "./lib/build.mjs";
import { advanceRun } from "./lib/phases.mjs";
import { recordPlan, promoteSprint } from "./lib/plan.mjs";
import { startSprint, verifySprint, finishSprint, bindCodexSession, openTurn } from "./lib/sprint.mjs";
import { auditRun } from "./lib/audit.mjs";
import { producerHint } from "./lib/gate.mjs";
import { reportRun, renderReport, renderReportMd } from "./lib/report.mjs";
import { proposeAction, ratifyAction } from "./lib/action.mjs";
import { shouldSweepAbandonedWorktree } from "./lib/worktree-sweep.mjs";
import { evaluateDoctor, gatherProbes, renderDoctor } from "./lib/doctor.mjs";
import { deriveNextAction } from "./lib/resume.mjs";
import { renderStatus } from "./lib/render-status.mjs";
import { COMMAND_META, renderCommandHelp, renderHelp } from "./lib/help.mjs";
import { partitionTouched } from "./lib/globmatch.mjs";

function fail(msg) {
  process.stderr.write(msg + "\n");
  process.exit(1);
}

function parseFlags(args) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      const key = args[i].slice(2);
      const next = args[i + 1];
      if (next === undefined || next.startsWith("--")) {
        flags[key] = undefined; // missing value → absent
      } else {
        flags[key] = next;
        i++;
      }
    } else {
      positional.push(args[i]);
    }
  }
  return { positional, flags };
}

function pidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e && e.code === "EPERM";
  }
}

function sweepAbandonedWorktrees(dir) {
  let s;
  try { s = readState(dir); } catch { return; }
  const left = [];
  for (const w of s.abandonedWorktrees ?? []) {
    if (!shouldSweepAbandonedWorktree(w, { pidAlive, hasTurnCompleted })) { left.push(w); continue; }
    if (!w.repoRoot || !w.worktreePath) continue;
    const r = discardTurnWorktree({ repoRoot: w.repoRoot, worktreePath: w.worktreePath });
    if (!r.removed && fs.existsSync(w.worktreePath)) left.push(w);
  }
  if ((s.abandonedWorktrees ?? []).length !== left.length) {
    s.abandonedWorktrees = left;
    writeState(dir, s);
  }
  try {
    for (const repoRoot of new Set((s.abandonedWorktrees ?? []).map((w) => w.repoRoot).filter(Boolean))) {
      gcWorktrees({ repoRoot });
    }
  } catch {}
}

function requireActiveRun(cwd) {
  const runId = readActiveRunId(cwd);
  if (!runId) fail(`no active jam run in this project — start one with 'jam diagnose "<topic>" --goal <file>' (repair) or 'jam start "<topic>" --mode greenfield'; see 'jam report --all' for past runs`);
  const dir = runDir(cwd, runId);
  try { sweepAbandonedWorktrees(dir); } catch {}
  return { runId, dir };
}

function genRunId() {
  return `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

const GOAL_TEMPLATE = `# Goal
<!-- What outcome do you want? One paragraph, plain language. -->

# Why
<!-- Why now; what breaks or stays broken if we don't do this. -->

# What "done" means
<!-- The acceptance you trust, e.g. "npm test passes, including a new regression test for the bug". -->
`;

function printRunAnnouncement(runId) {
  process.stdout.write(`state lives in docs/superpowers/loop-runs/${runId}/ (local run record — commit it or gitignore it, your call)\n`);
  process.stdout.write("roles: Codex produces digests/verdicts/code in recorded turns; Claude orchestrates; you approve at gates (jam approve / jam reject)\n");
}

function cmdStart(cwd, positional, flags) {
  const topic = positional.join(" ").trim();
  if (!topic) fail("usage: jam start <topic> [--mode greenfield]");
  const runId = flags["run-id"] || genRunId();
  const mode = flags.mode === "greenfield" ? "greenfield" : undefined;
  createRun({ projectRoot: cwd, runId, topic, mode });
  if (mode === "greenfield") {
    const { dir } = requireActiveRun(cwd);
    setGoal({ runDir: dir, text: topic, source: "human" });
    process.stdout.write(`started jam run ${runId} (mode greenfield, phase GROUND, gate GROUND-scope: pending)\n`);
    printRunAnnouncement(runId);
  } else {
    process.stdout.write(`started jam run ${runId} (phase ALIGN, gate ALIGN: pending)\n`);
    printRunAnnouncement(runId);
  }
}

function cmdDoctor(cwd) {
  const r = evaluateDoctor(gatherProbes(cwd));
  process.stdout.write(renderDoctor(r));
  if (!r.ok) process.exit(1);
  process.stdout.write('next: jam init (bootstrap) or jam diagnose "<topic>" --goal <file>\n');
}

function cmdInit(cwd) {
  const r = evaluateDoctor(gatherProbes(cwd));
  process.stdout.write(renderDoctor(r));
  process.stdout.write("\nstate: runs live in docs/superpowers/loop-runs/<run-id>/ (local; commit or gitignore — your call)\n");
  process.stdout.write("roles: Codex produces digests/verdicts/code in recorded turns; Claude orchestrates; you approve at gates (jam approve / jam reject)\n\n");
  const goal = path.join(cwd, "jam-goal.md");
  if (fs.existsSync(goal)) {
    process.stdout.write("jam-goal.md exists — left untouched\n");
  } else {
    fs.writeFileSync(goal, GOAL_TEMPLATE);
    process.stdout.write("wrote jam-goal.md — fill it in\n");
  }
  process.stdout.write('then: jam diagnose "<topic>" --goal jam-goal.md   (repair)\n      jam start "<topic>" --mode greenfield      (new build)\n');
  if (!r.ok) process.exit(1);
}

function cmdStatus(cwd) {
  const { runId, dir } = requireActiveRun(cwd);
  const state = readState(dir);
  process.stdout.write(renderStatus(state, runId));
}

function cmdNext(cwd) {
  const id = readActiveRunId(cwd);
  if (!id) return fail(`no active jam run in this project — start one with 'jam diagnose "<topic>" --goal <file>' (repair) or 'jam start "<topic>" --mode greenfield'`);
  const state = readState(runDir(cwd, id));
  process.stdout.write(`next: ${deriveNextAction(state).message}\n`);
}

function cmdResume(cwd) {
  const id = readActiveRunId(cwd);
  if (!id) {
    process.stdout.write('no active run — start one with \'jam diagnose "<topic>" --goal <file>\' (repair) or \'jam start "<topic>" --mode greenfield\'\n');
    let entries = [];
    try { entries = fs.readdirSync(runsRoot(cwd), { withFileTypes: true }).filter((d) => d.isDirectory()); } catch {}
    if (entries.length) return cmdReport(cwd, [], { all: undefined });
    return;
  }
  const dir = runDir(cwd, id);
  const st = readState(dir);
  process.stdout.write(renderStatus(st, id));
  const next = deriveNextAction(st);
  process.stdout.write(`\nnext: ${next.message}\n`);
}

function cmdRenderDigest(cwd, positional, flags) {
  const gateId = positional[0];
  if (!gateId || !flags.file) fail("usage: jam render-digest <gateId> --file <path>");
  const { dir } = requireActiveRun(cwd);
  let digest;
  try {
    digest = JSON.parse(fs.readFileSync(flags.file, "utf8"));
  } catch (e) {
    return fail(`cannot read digest file: ${e.message}`);
  }
  try {
    recordDigest({ runDir: dir, gateId, digest });
  } catch (e) {
    return fail(e.message);
  }
  process.stdout.write(`digest rendered for gate ${gateId}\n`);
}

function cmdApprove(cwd, positional) {
  const gateId = positional[0];
  if (!gateId) fail("usage: jam approve <gateId>");
  const { dir } = requireActiveRun(cwd);
  try {
    recordApproval({ runDir: dir, gateId, who: "user" });
  } catch (e) {
    return fail(e.message);
  }
  process.stdout.write(`gate ${gateId} approved\n`);
}

function cmdReject(cwd, positional, flags) {
  const gateId = positional[0];
  if (!gateId || !flags.reason) return fail('usage: jam reject <gateId> --reason "<text>"');
  const { dir } = requireActiveRun(cwd);
  try {
    rejectGate({ runDir: dir, gateId, reason: flags.reason });
  } catch (e) {
    return fail(e.message);
  }
  const st = readState(dir);
  const order = phaseOrderFor(st.mode);
  const gatePhase = order.find((p) => gateId === p || gateId.startsWith(p + "-"));
  if (gatePhase && order.indexOf(gatePhase) < order.indexOf(st.phase)) {
    const gEarly = st.gates?.[gateId];
    const rearEarly = gEarly ? producerHint(gateId, gEarly.approveFrom ?? "rendered", st) : null;
    process.stdout.write(`gate ${gateId} rejected — it belongs to the earlier phase ${gatePhase}: re-producing${rearEarly ? ` (${rearEarly})` : ""} may require 'jam rewind ${gatePhase} --confirm ${gatePhase}' first (phase-bound greenfield producers); repair digest/plan producers can run from any phase\n`);
  } else {
    const gNow = st.gates?.[gateId];
    const rear = gNow ? producerHint(gateId, gNow.approveFrom ?? "rendered", st) : null;
    process.stdout.write(`gate ${gateId} rejected — re-produce its artifact${rear ? ` (${rear})` : ""}, then approve\n`);
  }
}

function cmdRewind(cwd, positional, flags) {
  const toPhase = positional[0];
  if (!toPhase || !flags.confirm) return fail("usage: jam rewind <phase> --confirm <phase>   (rewind invalidates approvals)");
  const { dir } = requireActiveRun(cwd);
  try {
    rewindPhase({ runDir: dir, toPhase, confirm: flags.confirm });
  } catch (e) {
    return fail(e.message);
  }
  process.stdout.write(`rewound to ${toPhase} — later-phase gates re-armed; re-produce artifacts and re-approve. (The working tree is NOT rolled back — that is git's job.)\n`);
}

function cmdDial(cwd, positional, flags) {
  const gateId = positional[0];
  if (!gateId || !flags.mode) return fail("usage: jam dial <gateId> --mode <human|show-and-proceed> [--confirm <gateId>]");
  const { dir } = requireActiveRun(cwd);
  try {
    dialGate({ runDir: dir, gateId, mode: flags.mode, confirm: flags.confirm });
  } catch (e) {
    return fail(e.message);
  }
  process.stdout.write(`gate ${gateId} dialed to ${flags.mode}\n`);
}

function cmdAddGate(cwd, positional, flags) {
  const gateId = positional[0];
  if (!gateId || !flags.mode) fail("usage: jam add-gate <gateId> --mode <human|auto|show-and-proceed>");
  const { dir } = requireActiveRun(cwd);
  try {
    addGate({ runDir: dir, gateId, mode: flags.mode });
  } catch (e) {
    return fail(e.message);
  }
  process.stdout.write(`added gate ${gateId} (${flags.mode})\n`);
}

function cmdEvidence(cwd, positional, flags) {
  const gateId = positional[0];
  if (!gateId || !flags.sprint || !flags.cmd) {
    fail('usage: jam evidence <gateId> --sprint <id> --cmd "<command>"');
  }
  const { dir } = requireActiveRun(cwd);
  let result;
  try {
    ({ result } = recordEvidence({ runDir: dir, gateId, sprintId: flags.sprint, command: flags.cmd, cwd }));
  } catch (e) {
    return fail(e.message);
  }
  process.stdout.write(`evidence for ${gateId}: exit ${result.exitCode}\n`);
}

function cmdSteer(cwd, positional) {
  const text = positional.join(" ").trim();
  if (!text) fail("usage: jam steer <redirection text>");
  const { dir } = requireActiveRun(cwd);
  const d = addSteering({ runDir: dir, text });
  process.stdout.write(`recorded steering directive ${d.id}\n`);
}

function cmdProposeAction(cwd, positional, flags) {
  const id = positional[0];
  if (!id || !flags.type) return fail("usage: jam propose-action <id> --type <t> [--target <x>] [--command <c>]");
  const { dir } = requireActiveRun(cwd);
  try {
    const { irreversible, reasons } = proposeAction({ runDir: dir, id, type: flags.type, target: flags.target, command: flags.command });
    if (irreversible) process.stdout.write(`action ${id}: HARD-BLOCKED (irreversible): ${reasons.join("; ")}\n  ratify with: jam ratify ${id} --confirm ${id}  (or: jam ratify ${id} --deny)\n`);
    else process.stdout.write(`action ${id}: reversible (ok to proceed)\n`);
  } catch (e) { return fail(e.message); }
}

function cmdRatify(cwd, positional, flags) {
  const id = positional[0];
  if (!id) return fail("usage: jam ratify <id> --confirm <id> | --deny");
  const { dir } = requireActiveRun(cwd);
  try {
    if ("deny" in flags) { ratifyAction({ runDir: dir, id, deny: true }); process.stdout.write(`action ${id}: denied\n`); }
    else if (flags.confirm) { ratifyAction({ runDir: dir, id, confirm: flags.confirm }); process.stdout.write(`action ${id}: ratified\n`); }
    else return fail("usage: jam ratify <id> --confirm <id> | --deny");
  } catch (e) { return fail(e.message); }
}

function cmdGround(cwd, positional, flags) {
  const sub = positional[0];
  const { dir } = requireActiveRun(cwd);
  const readFile = () => {
    if (!flags.file) return fail("usage: jam ground <sharpen|claim|converge> --file <json>  (refute uses --id)");
    return JSON.parse(fs.readFileSync(flags.file, "utf8"));
  };
  try {
    switch (sub) {
      case "sharpen": {
        const o = readFile();
        sharpenIntent({ runDir: dir, problem: o.problem, dimensions: o.dimensions });
        return process.stdout.write(`intent sharpened; GROUND-scope is now scoped — approve with: jam approve GROUND-scope\n`);
      }
      case "claim": {
        const o = readFile();
        addClaim({ runDir: dir, id: o.id, text: o.text, kind: o.kind, status: o.status, source: o.source, evidenceRef: o.evidenceRef });
        return process.stdout.write(`claim ${o.id} recorded (${o.kind}/${o.status})\n`);
      }
      case "refute": {
        if (!flags.id) return fail("usage: jam ground refute --id <claimId>");
        refuteClaim({ runDir: dir, id: flags.id });
        return process.stdout.write(`claim ${flags.id} refuted (dropped)\n`);
      }
      case "converge": {
        const o = flags.file ? readFile() : {};
        convergeGrounding({ runDir: dir, options: o.options, openUnknowns: o.openUnknowns });
        return process.stdout.write(`grounding converged; GROUND is now grounded — ratify with: jam approve GROUND\n`);
      }
      default:
        return fail("usage: jam ground <sharpen|claim|refute|converge>");
    }
  } catch (e) { return fail(e.message); }
}

function cmdConverge(cwd, positional, flags) {
  const sub = positional[0];
  const { dir } = requireActiveRun(cwd);
  const readFile = () => {
    if (!flags.file) return fail("usage: jam converge <shortlist|decide|finalize> --file <json>  (tiebreak uses --choose)");
    return JSON.parse(fs.readFileSync(flags.file, "utf8"));
  };
  try {
    switch (sub) {
      case "shortlist": {
        const o = readFile();
        setShortlist({ runDir: dir, options: o.options });
        return process.stdout.write(`shortlist set; approve with: jam approve CONVERGE-shortlist\n`);
      }
      case "decide": {
        if (!flags.agent) return fail("usage: jam converge decide --agent <claude|codex> --file <json>");
        const o = readFile();
        const s = recordDecision({ runDir: dir, agent: flags.agent, chosen: o.chosen, rationale: o.rationale, spikes: o.spikes });
        const c = s.convergence;
        const tail = (c.decisions.claude && c.decisions.codex) ? (c.agree ? ` — agree on ${c.chosen}` : ` — DISAGREE; rule with: jam converge tiebreak --choose <opt>`) : "";
        return process.stdout.write(`decision recorded for ${flags.agent}${tail}\n`);
      }
      case "tiebreak": {
        if (!flags.choose) return fail("usage: jam converge tiebreak --choose <option>");
        ruleTiebreak({ runDir: dir, chosen: flags.choose });
        return process.stdout.write(`tiebreak ruled: ${flags.choose}\n`);
      }
      case "finalize": {
        const o = flags.file ? readFile() : {};
        convergeDecision({ runDir: dir, ledger: o.ledger, spikes: o.spikes, acceptedUnknowns: o.acceptedUnknowns });
        return process.stdout.write(`convergence decided; ratify with: jam approve CONVERGE\n`);
      }
      default:
        return fail("usage: jam converge <shortlist|decide|tiebreak|finalize>");
    }
  } catch (e) { return fail(e.message); }
}

function cmdSpecify(cwd, positional, flags) {
  const sub = positional[0];
  const { dir } = requireActiveRun(cwd);
  const readFile = () => {
    if (!flags.file) return fail("usage: jam specify <coverage|gameability> --file <json>  (redproof/certify take no file)");
    return JSON.parse(fs.readFileSync(flags.file, "utf8"));
  };
  try {
    switch (sub) {
      case "coverage": {
        const o = readFile();
        setCoverage({ runDir: dir, verifyCmd: o.verifyCmd, checks: o.checks });
        return process.stdout.write(`coverage set; approve with: jam approve SPECIFY-coverage\n`);
      }
      case "redproof": {
        const s = recordRedProof({ runDir: dir, cwd });
        return process.stdout.write(`red-first: verifyCmd exited ${s.spec.redProof.exitCode}${s.spec.redProof.exitCode === 0 ? " — WARNING: must be non-zero to certify" : ""}\n`);
      }
      case "gameability": {
        const o = readFile();
        recordGameability({ runDir: dir, reviewer: o.reviewer, author: o.author, survivingFindings: o.survivingFindings, findings: o.findings });
        return process.stdout.write(`gameability verdict recorded (surviving: ${o.survivingFindings})\n`);
      }
      case "certify": {
        certifyVerifyCmd({ runDir: dir, cwd });
        return process.stdout.write(`verifyCmd certified; ratify the SSOT with: jam approve SPECIFY\n`);
      }
      default:
        return fail("usage: jam specify <coverage|redproof|gameability|certify>");
    }
  } catch (e) { return fail(e.message); }
}

function cmdBuild(cwd, positional, flags) {
  const sub = positional[0];
  const { dir } = requireActiveRun(cwd);
  try {
    switch (sub) {
      case "plan": {
        if (!flags.file) return fail("usage: jam build plan --file <json with {sprints:[...]}>");
        const o = JSON.parse(fs.readFileSync(flags.file, "utf8"));
        recordBuildPlan({ runDir: dir, sprints: o.sprints, verifyCmd: o.verifyCmd });
        return process.stdout.write(`build plan recorded (verifyCmd locked to the certified SSOT); approve with: jam approve BUILD-plan\n`);
      }
      default:
        return fail("usage: jam build plan --file <json>");
    }
  } catch (e) { return fail(e.message); }
}

function cmdCancel(cwd, positional, flags) {
  const { runId, dir } = requireActiveRun(cwd);
  if (flags.confirm !== runId) return fail(`cancel is irreversible — re-run with --confirm ${runId}`);
  cancelRun({ projectRoot: cwd, runDir: dir });
  process.stdout.write("jam run cancelled\n");
}

function cmdDiagnose(cwd, positional, flags) {
  const topic = positional.join(" ").trim();
  const diagnoseUsage = 'usage: jam diagnose <topic> --goal <file>  (or --goal-codex <goalId>)\n--goal-codex <goalId> reads the goal text from a Codex-stored goal; most users want --goal <file>';
  if (!topic) fail(diagnoseUsage);
  let text, source;
  if (flags.goal) {
    try { text = fs.readFileSync(flags.goal, "utf8"); source = `file:${flags.goal}`; }
    catch (e) { return fail(`cannot read goal file: ${e.message}\n(the goal file is free-form markdown describing what "done" means)`); }
  } else if (flags["goal-codex"]) {
    const r = spawnSync("python3", ["-c",
      "import sqlite3,sys,os;c=sqlite3.connect(os.path.join(os.path.expanduser('~'),'.codex','goals_1.sqlite'));"+
      "r=c.execute('select objective from thread_goals where goal_id=?',(sys.argv[1],)).fetchone();"+
      "print(r[0] if r else '')", flags["goal-codex"]], { encoding: "utf8" });
    text = (r.stdout || "").trim(); source = `codex:${flags["goal-codex"]}`;
  } else {
    return fail(diagnoseUsage);
  }
  if (!text || !text.trim()) {
    return fail('goal is empty; provide a non-empty --goal <file> or a valid --goal-codex <goalId>\n--goal-codex <goalId> reads the goal text from a Codex-stored goal; most users want --goal <file>');
  }
  const runId = flags["run-id"] || genRunId();
  createRun({ projectRoot: cwd, runId, topic, mode: "repair" });
  setGoal({ runDir: runDir(cwd, runId), text, source });
  process.stdout.write(`started repair run ${runId} (phase DIAGNOSE, gate DIAGNOSE: pending)\n`);
  printRunAnnouncement(runId);
}

function cmdVerify(cwd, positional, flags) {
  if (!flags.file) fail("usage: jam verify --file <verdict.json>");
  const { dir } = requireActiveRun(cwd);
  let verdict;
  try { verdict = JSON.parse(fs.readFileSync(flags.file, "utf8")); }
  catch (e) { return fail(`cannot read verdict file: ${e.message}`); }
  const gateId = readState(dir).phase;
  let blockers;
  try { ({ blockers } = recordVerification({ runDir: dir, gateId, verdict })); }
  catch (e) { return fail(e.message); }
  process.stdout.write(blockers === 0
    ? `verified gate ${gateId} (no surviving blockers)\n`
    : `gate ${gateId} NOT verified — ${blockers} blocker(s) survive; revise the diagnosis\n`);
}

function cmdAdvance(cwd) {
  const { dir } = requireActiveRun(cwd);
  let state;
  try { state = advanceRun({ runDir: dir }); }
  catch (e) { return fail(e.message); }
  process.stdout.write(`advanced to phase ${state.phase}\n`);
}

function maybeBindSprint({ cwd, flags, status, sessionId }) {
  if (!("sprint" in flags) || !flags.sprint) return;
  if (status !== "completed") {
    process.stdout.write(`not bound (turn did not complete; nothing to bind)\n`);
    return;
  }
  if (!sessionId) {
    process.stdout.write(`not bound: could not resolve a Codex session id for sprint ${flags.sprint}\n`);
    return;
  }
  const { dir } = requireActiveRun(cwd);
  const transcriptPath = locateTranscript(sessionId) ?? null;
  const st = bindCodexSession({ runDir: dir, sprintId: flags.sprint, sessionId, transcriptPath });
  const sess = (st.plan?.sprints?.find((s) => s.id === flags.sprint)?.codexSessions ?? []).slice(-1)[0];
  const stored = sess ? sess.transcriptPath : null;
  process.stdout.write(`bound session ${sessionId} to sprint ${flags.sprint} (transcript: ${stored ?? "none — rollout did not content-match the session"})\n`);
}

const RECONCILE_EXCLUDES = ["--", ".", ":(exclude).jam/**", ":(exclude)docs/superpowers/loop-runs/**"];

function gitText(repoRoot, args, opts = {}) {
  const r = spawnSync("git", ["-C", repoRoot, ...args], { encoding: "utf8", ...opts });
  return { code: r.status === null ? -1 : r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

// CLI reconcile uses a patch file instead of piping patch text to `git apply`; in sandboxed
// subprocesses the stdin path can block, while file-based apply is deterministic.
function reconcileTurnWorktreeForCli({ repoRoot, worktreePath, baselineRef, headAtOpen, allowedPaths }) {
  if (!worktreePath || !baselineRef || !fs.existsSync(worktreePath)) return { applied: false, error: "missing worktree or baseline" };
  if (headAtOpen && gitText(repoRoot, ["rev-parse", "HEAD"]).stdout.trim() !== headAtOpen) return { applied: false, headMoved: true };
  if (gitText(worktreePath, ["add", "-A"]).code !== 0) return { applied: false, error: "git add failed in worktree" };
  const ndArgs = (Array.isArray(allowedPaths) && allowedPaths.length)
    ? ["diff", "--cached", "--name-only", "-z", "--no-renames", baselineRef, ...RECONCILE_EXCLUDES]
    : ["diff", "--cached", "--name-only", "-z", baselineRef, ...RECONCILE_EXCLUDES];
  const nd = gitText(worktreePath, ndArgs);
  if (nd.code !== 0) return { applied: false, error: "git diff (names) failed" };
  const allNames = nd.stdout.split("\0").filter(Boolean);
  if (allNames.some((p) => p.includes("\n"))) return { applied: false, error: "touched path contains a newline — refusing to reconcile" };
  const { kept: names, dropped } = partitionTouched(allNames, allowedPaths);
  if (names.length === 0) return { applied: false, empty: true, dropped, kept: [] };
  for (const p of names) {
    const bp = gitText(repoRoot, ["rev-parse", `${baselineRef}:${p}`]);
    const baseId = bp.code === 0 ? bp.stdout.trim() : null;
    const abs = path.join(repoRoot, p);
    const mainId = fs.existsSync(abs) ? gitText(repoRoot, ["hash-object", abs]).stdout.trim() : null;
    if (baseId !== mainId) return { applied: false, drift: true, path: p, dropped, kept: names };
  }
  const stripping = Array.isArray(allowedPaths) && allowedPaths.length > 0;
  const pd = stripping
    ? gitText(worktreePath, ["diff", "--cached", "--binary", "--no-renames", baselineRef, "--", ...names.map((n) => `:(literal)${n}`)])
    : gitText(worktreePath, ["diff", "--cached", "--binary", baselineRef, ...RECONCILE_EXCLUDES]);
  if (pd.code !== 0) return { applied: false, error: "git diff (patch) failed" };
  const patchFile = path.join(os.tmpdir(), `jam-reconcile-${process.pid}-${Math.random().toString(36).slice(2)}.patch`);
  try {
    fs.writeFileSync(patchFile, pd.stdout);
    const check = gitText(repoRoot, ["apply", "--check", patchFile]);
    if (check.code !== 0) return { applied: false, drift: true, stderr: check.stderr ?? "", dropped, kept: names };
    const apply = gitText(repoRoot, ["apply", patchFile]);
    if (apply.code !== 0) return { applied: false, error: apply.stderr ?? "", dropped, kept: names };
    return { applied: true, kept: names, dropped };
  } finally {
    try { fs.rmSync(patchFile, { force: true }); } catch {}
  }
}

async function cmdCodexRun(cwd, positional, flags) {
  if (!flags["prompt-file"]) return fail("usage: jam codex-run --prompt-file <f> [--timeout <ms>] [--cwd <dir>] [--out-dir <dir>] [--sprint <id>] — the prompt file is written by the jam-prompting skill (Claude's instructions for this Codex turn)");
  let prompt;
  try { prompt = fs.readFileSync(flags["prompt-file"], "utf8"); } catch (e) { return fail(`cannot read prompt file: ${e.message}`); }
  if (flags.sprint) {
    const { dir } = requireActiveRun(cwd);
    const state = readState(dir);
    const sprint = state.plan?.sprints?.find((s) => s.id === flags.sprint);
    if (Array.isArray(sprint?.allowedPaths) && sprint.allowedPaths.length > 0) {
      prompt = `SCOPE LOCK — you may modify ONLY these paths:\n${sprint.allowedPaths.map((g) => `- ${g}`).join("\n")}\n\n${prompt}`;
    }
  }
  let outDir = flags["out-dir"] ? path.resolve(cwd, flags["out-dir"]) : fs.mkdtempSync(path.join(os.tmpdir(), "jam-codex-"));
  let turnWt = null;
  let baselineRef = null;
  let isolated = false;
  let turnRepoRoot = null;
  const baseCwd = flags.cwd || cwd;

  if (flags.sprint && isGitRepo(baseCwd)) {
    const { dir, runId } = requireActiveRun(cwd);
    const pre = readState(dir);
    const preSp = pre.plan?.sprints?.find((x) => x.id === flags.sprint);
    if (preSp?.turn && preSp.turn.status === "open") {
      preSp.turn.status = "discarded";
      (pre.abandonedWorktrees ??= []).push({
        repoRoot: preSp.turn.repoRoot || baseCwd,
        worktreePath: preSp.turn.worktreePath,
        pid: preSp.turn.pid,
        eventLog: preSp.turn.eventLog
      });
      writeState(dir, pre);
      appendLedger(dir, { at: new Date().toISOString(), type: "turn-discarded", sprintId: flags.sprint, token: preSp.turn.token, reason: "superseded" });
    }
    const seqState = openTurn({ runDir: dir, sprintId: flags.sprint });
    try {
      const wt = openTurnWorktree({ repoRoot: baseCwd, sprintId: flags.sprint, token: seqState.token, runId });
      turnWt = wt.worktreePath;
      baselineRef = wt.baselineRef;
      isolated = true;
      turnRepoRoot = wt.repoRoot;
      if (outDir === turnRepoRoot || outDir.startsWith(turnRepoRoot + path.sep)) {
        outDir = fs.mkdtempSync(path.join(os.tmpdir(), "jam-turn-"));
        process.stdout.write("(relocated turn I/O out of the repo working tree)\n");
      }
      const s = readState(dir);
      const sp = s.plan.sprints.find((x) => x.id === flags.sprint);
      sp.turn.worktreePath = turnWt;
      sp.turn.baselineRef = baselineRef;
      sp.turn.repoRoot = turnRepoRoot;
      sp.turn.headAtOpen = wt.headAtOpen;
      writeState(dir, s);
    } catch (e) {
      const s = readState(dir);
      const sp = s.plan.sprints.find((x) => x.id === flags.sprint);
      if (sp?.turn && sp.turn.status === "open") {
        sp.turn.status = "discarded";
        if (sp.turn.worktreePath) {
          (s.abandonedWorktrees ??= []).push({
            repoRoot: sp.turn.repoRoot || baseCwd,
            worktreePath: sp.turn.worktreePath,
            pid: sp.turn.pid,
            eventLog: sp.turn.eventLog
          });
        }
        writeState(dir, s);
        appendLedger(dir, { at: new Date().toISOString(), type: "turn-discarded", sprintId: flags.sprint, token: sp.turn.token, reason: "worktree-open-failed" });
      }
      return fail(`could not open turn worktree: ${e.message}`);
    }
  } else if (flags.sprint) {
    const { dir } = requireActiveRun(cwd);
    openTurn({ runDir: dir, sprintId: flags.sprint, isolated: false });
    appendLedger(dir, { at: new Date().toISOString(), type: "turn-unisolated", sprintId: flags.sprint });
    process.stdout.write("turn isolation OFF (not a git repo) - Codex will edit the working tree in place. Run 'jam doctor' for setup guidance.\n");
  }

  fs.mkdirSync(outDir, { recursive: true });
  const eventLog = path.join(outDir, "events.jsonl");
  const lastMsg = path.join(outDir, "last.md");
  if (flags.sprint && isolated) {
    const { dir } = requireActiveRun(cwd);
    const s = readState(dir);
    const sp = s.plan.sprints.find((x) => x.id === flags.sprint);
    if (sp?.turn) {
      sp.turn.eventLog = eventLog;
      writeState(dir, s);
    }
  }
  const runCwd = turnWt ? path.join(turnWt, path.relative(turnRepoRoot, path.resolve(baseCwd))) : baseCwd;
  if (turnWt) {
    const realWt = fs.realpathSync.native(turnWt);
    let realRun;
    try { realRun = fs.realpathSync.native(runCwd); } catch { realRun = null; }
    if (!realRun || (realRun !== realWt && !realRun.startsWith(realWt + path.sep))) {
      const { dir } = requireActiveRun(cwd);
      const s = readState(dir);
      const sp = s.plan.sprints.find((x) => x.id === flags.sprint);
      if (sp?.turn && sp.turn.status === "open") {
        sp.turn.status = "discarded";
        if (sp.turn.worktreePath) {
          (s.abandonedWorktrees ??= []).push({
            repoRoot: sp.turn.repoRoot || baseCwd,
            worktreePath: sp.turn.worktreePath,
            pid: sp.turn.pid,
            eventLog: sp.turn.eventLog
          });
        }
        writeState(dir, s);
        appendLedger(dir, { at: new Date().toISOString(), type: "turn-discarded", sprintId: flags.sprint, token: sp.turn.token, reason: "cwd-escape" });
      }
      return fail("--cwd resolves outside the isolated worktree (symlink escape) — refusing to start the turn");
    }
  }
  const startInfo = codexStart({ prompt, cwd: runCwd, eventLog, lastMsg });
  if (flags.sprint && isolated) {
    const { dir } = requireActiveRun(cwd);
    const s = readState(dir);
    const sp = s.plan.sprints.find((x) => x.id === flags.sprint);
    if (sp?.turn) {
      sp.turn.pid = startInfo.pid;
      writeState(dir, s);
    }
  }
  const timeoutMs = Number(flags.timeout) || 120000;
  const r = await codexWait({ eventLog, lastMsg, timeoutMs });
  process.stdout.write(`status: ${r.status}\nsession: ${r.sessionId ?? "(none)"}\nout-dir: ${outDir}\n`);
  if (r.status === "completed") process.stdout.write(`message:\n${r.lastMessage ?? ""}\n`);
  else if (flags.sprint && isolated) process.stdout.write(`Codex turn did not complete within ${timeoutMs}ms. It may still be running (NOT killed). When it completes, run: jam reconcile --sprint ${flags.sprint}. If this persists, run 'jam doctor' — the Codex CLI may be missing or unauthenticated.\n`);
  else process.stdout.write(`Codex turn did not complete within ${timeoutMs}ms. It may still be running (NOT killed). Resume with: jam codex-resume ${r.sessionId ?? "<id>"} --prompt-file <reply>. If this persists, run 'jam doctor' — the Codex CLI may be missing or unauthenticated.\n`);
  maybeBindSprint({ cwd, flags, status: r.status, sessionId: r.sessionId });
  if (flags.sprint && isolated && r.status === "completed") {
    reconcileActiveTurn(cwd, flags.sprint);
  }
}

function reconcileActiveTurn(cwd, sprintId) {
  const { dir } = requireActiveRun(cwd);
  let state = readState(dir);
  let sprint = state.plan?.sprints?.find((s) => s.id === sprintId);
  if (!sprint || !sprint.turn) return fail(`no turn to reconcile for sprint ${sprintId}`);
  let t = sprint.turn;
  if (t.status !== "open") {
    process.stdout.write(`turn ${t.token} already ${t.status}\n`);
    return;
  }
  const repoRoot = t.repoRoot || cwd;
  if (t.token !== `${sprintId}#${sprint.turnSeq}`) {
    t.status = "discarded";
    (state.abandonedWorktrees ??= []).push({ repoRoot, worktreePath: t.worktreePath, pid: t.pid, eventLog: t.eventLog });
    writeState(dir, state);
    appendLedger(dir, { at: new Date().toISOString(), type: "turn-discarded", sprintId, token: t.token, reason: "superseded" });
    return fail(`turn ${t.token} was superseded - not reconciled, main tree untouched`);
  }
  if (!t.eventLog || !hasTurnCompleted(t.eventLog)) return fail(`turn ${t.token} is still running - not reconcilable yet (re-run when complete)`);
  if (!t.sessionId) {
    const sid = sessionIdFromEventLog(t.eventLog);
    if (!sid) return fail(`turn ${t.token}: cannot resolve a Codex session id from the event log`);
    bindCodexSession({ runDir: dir, sprintId, sessionId: sid });
    state = readState(dir);
    sprint = state.plan.sprints.find((s) => s.id === sprintId);
    t = sprint.turn;
    if (!t.sessionId) return fail(`turn ${t.token}: bound session has no locatable/matching transcript - refusing`);
  }
  const res = reconcileTurnWorktreeForCli({ repoRoot, worktreePath: t.worktreePath, baselineRef: t.baselineRef, headAtOpen: t.headAtOpen, allowedPaths: sprint.allowedPaths });
  if (res.dropped?.length) {
    appendLedger(dir, { at: new Date().toISOString(), type: "turn-scope-stripped", sprintId, token: t.token, dropped: res.dropped, kept: res.kept ?? [] });
    process.stdout.write(`scope-stripped ${res.dropped.length} out-of-allowlist path(s) from turn ${t.token}: ${res.dropped.join(", ")}\n`);
  }
  if (res.headMoved) return fail("reconcile aborted: controller HEAD moved during the turn - a turn may have moved the branch via shared refs; inspect and reset before retrying");
  if (res.drift) return fail("reconcile aborted: main tree drifted from the turn baseline");
  if (res.error) return fail(`reconcile failed: ${res.error}`);
  if (!res.applied && !res.empty) return fail("reconcile failed to apply the turn diff");
  const dr = discardTurnWorktree({ repoRoot, worktreePath: t.worktreePath });
  if (!dr.removed) (state.abandonedWorktrees ??= []).push({ repoRoot, worktreePath: t.worktreePath, pid: t.pid, eventLog: t.eventLog });
  t.status = "reconciled";
  writeState(dir, state);
  appendLedger(dir, { at: new Date().toISOString(), type: "turn-reconciled", sprintId, token: t.token, sessionId: t.sessionId });
  process.stdout.write(`reconciled turn ${t.token} into the working tree\n`);
}

function cmdReconcile(cwd, positional, flags) {
  if (!flags.sprint) return fail("usage: jam reconcile --sprint <id>");
  reconcileActiveTurn(cwd, flags.sprint);
}

async function cmdCodexResume(cwd, positional, flags) {
  const sessionId = positional[0];
  if (!sessionId || !flags["prompt-file"]) return fail("usage: jam codex-resume <sessionId> --prompt-file <f> [--timeout <ms>] [--out-dir <dir>]");
  if (flags.sprint && isGitRepo(flags.cwd || cwd)) {
    return fail(`codex-resume --sprint is not isolated. A timed-out isolated turn keeps running in its worktree (never killed) - wait for it, then 'jam reconcile --sprint ${flags.sprint}', or run 'jam codex-run --sprint ${flags.sprint}' to open a fresh isolated turn.`);
  }
  let prompt;
  try { prompt = fs.readFileSync(flags["prompt-file"], "utf8"); } catch (e) { return fail(`cannot read prompt file: ${e.message}`); }
  const outDir = flags["out-dir"] || fs.mkdtempSync(path.join(os.tmpdir(), "jam-codex-"));
  fs.mkdirSync(outDir, { recursive: true });
  const eventLog = path.join(outDir, "events.jsonl");
  const lastMsg = path.join(outDir, "last.md");
  codexResume({ sessionId, prompt, eventLog, lastMsg });
  const timeoutMs = Number(flags.timeout) || 120000;
  const r = await codexWait({ eventLog, lastMsg, timeoutMs });
  process.stdout.write(`status: ${r.status}\nsession: ${r.sessionId ?? sessionId}\nout-dir: ${outDir}\n`);
  if (r.status === "completed") process.stdout.write(`message:\n${r.lastMessage ?? ""}\n`);
  else process.stdout.write(`Codex turn did not complete within ${timeoutMs}ms. It may still be running (NOT killed).\n`);
  maybeBindSprint({ cwd, flags, status: r.status, sessionId: r.sessionId ?? sessionId });
}

function cmdCodexStatus(cwd, positional, flags) {
  if (!flags["event-log"]) fail("usage: jam codex-status --event-log <events.jsonl>");
  const eventLog = flags["event-log"];
  const status = classifyTurn({ eventLog });
  const sessionId = sessionIdFromEventLog(eventLog);
  const transcript = sessionId ? locateTranscript(sessionId) : null;
  process.stdout.write(`turn: ${status}\nsession: ${sessionId ?? "(none)"}\ntranscript: ${transcript ?? "(not found)"}\n`);
}

function cmdSprint(cwd, positional, flags) {
  const id = positional[0];
  if (!id) return fail("usage: jam sprint <id> --start|--verify|--done");
  const { dir } = requireActiveRun(cwd);
  try {
    if ("start" in flags) {
      startSprint({ runDir: dir, sprintId: id });
      process.stdout.write(`sprint ${id}: in-progress\n`);
    } else if ("verify" in flags) {
      // Always exits 0; the verifyCmd's exit code is reported in stdout and recorded in the gate.
      // The gate (not this process's exit code) is what blocks --done. Check stdout / `jam status`.
      const { result } = verifySprint({ runDir: dir, sprintId: id, cwd });
      process.stdout.write(`sprint ${id} verify: exit ${result.exitCode}\n`);
      if (result.exitCode !== 0) {
        const tail = `${result.stdout ?? ""}${result.stderr ?? ""}`.split("\n").filter(Boolean).slice(-20).join("\n");
        if (tail) process.stdout.write(tail + "\n");
        process.stdout.write(`full output: ${path.join(dir, "evidence", `${id}.json`)} — recorded; --done stays blocked until verifyCmd passes\n`);
      }
    } else if ("done" in flags) {
      finishSprint({ runDir: dir, sprintId: id });
      process.stdout.write(`sprint ${id}: done\n`);
    } else {
      return fail("usage: jam sprint <id> --start|--verify|--done");
    }
  } catch (e) {
    return fail(e.message);
  }
}

function cmdPlan(cwd, positional, flags) {
  if (!flags.file) return fail("usage: jam plan --file <plan.json>");
  const { dir } = requireActiveRun(cwd);
  let plan;
  try { plan = JSON.parse(fs.readFileSync(flags.file, "utf8")); } catch (e) { return fail(`cannot read plan file: ${e.message}`); }
  let state;
  try { state = recordPlan({ runDir: dir, plan }); } catch (e) { return fail(e.message); }
  process.stdout.write(`plan recorded: ${state.plan.sprints.length} sprint(s); verify: ${state.plan.verifyCmd}\n`);
}

function cmdPromoteSprint(cwd, positional, flags) {
  const id = positional[0];
  if (!id || !flags.title || !flags.reason) return fail("usage: jam promote-sprint <id> --title <t> --reason <r> [--acceptance <a>] [--discovered-by <d>] [--allow <comma-globs>]");
  const { dir } = requireActiveRun(cwd);
  try {
    promoteSprint({ runDir: dir, id, title: flags.title, acceptanceCriteria: flags.acceptance, discoveredBy: flags["discovered-by"], reason: flags.reason, needs: flags.needs ? String(flags.needs).split(",").map((x) => x.trim()).filter(Boolean) : [], allowedPaths: flags.allow ? String(flags.allow).split(",").map((x) => x.trim()).filter(Boolean) : undefined });
    process.stdout.write(`promoted sprint ${id} (provenance: promoted)\n`);
  } catch (e) { return fail(e.message); }
}

function cmdAudit(cwd) {
  const { dir } = requireActiveRun(cwd);
  const { ok, failures } = auditRun({ runDir: dir });
  if (ok) { process.stdout.write("audit: PASS\n"); return; }
  return fail("audit: FAIL\n" + failures.map((f) => "  - " + f).join("\n"));
}

function cmdReport(cwd, positional, flags) {
  if ("all" in flags) {                                       // parseFlags stores bare flags as undefined — presence check
    const rootDir = runsRoot(cwd);
    let entries = [];
    try { entries = fs.readdirSync(rootDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch {}
    for (const id of entries.sort()) {
      const rep = reportRun({ runDir: runDir(cwd, id) });
      if (rep.error) { process.stdout.write(`${id}  (unreadable)\n`); continue; }
      const audit = rep.audit === null ? "-" : rep.audit.error ? "-" : rep.audit.ok ? "PASS" : "FAIL";
      process.stdout.write(`${id}  ${rep.run.mode}  ${rep.run.phase ?? "?"}  sprints ${rep.totals.done}/${rep.totals.sprints}  reviews ${rep.reviews.rounds.length}  audit ${audit}\n`);
    }
    return;
  }
  let dir, runIdUsed;
  if (positional[0]) {
    runIdUsed = positional[0];
    dir = runDir(cwd, runIdUsed);
    if (!fs.existsSync(dir)) return fail(`no such run: ${runIdUsed}`);
  } else {
    // STRICT read-only: do NOT use requireActiveRun (its abandoned-worktree sweep can WRITE state.json).
    const id = readActiveRunId(cwd);
    if (!id) return fail("no active jam run in this project (run `jam report <runId>` or start a run)");
    runIdUsed = id;
    dir = runDir(cwd, id);
    if (!fs.existsSync(dir)) return fail(`active run ${id} has no run directory`);
  }
  const rep = reportRun({ runDir: dir });
  if (rep.error) return fail(rep.error);
  if ("md" in flags && "json" in flags) return fail("report: --md and --json are mutually exclusive");
  if ("md" in flags) {
    const docDir = (sub) => {
      try {
        return fs.readdirSync(path.join(cwd, "docs", "superpowers", sub))
          .filter((f) => f.endsWith(".md") && f.includes(runIdUsed));
      } catch { return []; }
    };
    const out = path.join(dir, "report.md");
    fs.writeFileSync(out, renderReportMd(rep, { runId: runIdUsed, specs: docDir("specs"), plans: docDir("plans") }));
    process.stdout.write(`wrote ${out}\n`);
    return;
  }
  process.stdout.write("json" in flags ? JSON.stringify(rep, null, 2) + "\n" : renderReport(rep));
}
function cmdReviewRound(cwd, positional, flags) {
  const phase = flags.phase, rawRound = flags.round, rawBlockers = flags.blockers;
  if (!["VERIFY", "SLICE"].includes(phase)) return fail("usage: jam review-round --phase VERIFY|SLICE --round <n> --blockers <k> [--notes <text>]");
  if (!/^[1-9]\d*$/.test(String(rawRound))) return fail("review-round: --round must be a positive integer");
  if (!/^(0|[1-9]\d*)$/.test(String(rawBlockers))) return fail("review-round: --blockers must be a non-negative integer");
  const round = Number(rawRound), blockers = Number(rawBlockers);
  if (flags.notes && String(flags.notes).length > 500) return fail("review-round: --notes must be ≤ 500 characters");   // refuse, never silently truncate
  const notes = flags.notes ? String(flags.notes) : undefined;
  // APPEND-ONLY: resolve the active run WITHOUT requireActiveRun (its abandoned-worktree sweep can write state.json).
  const id = readActiveRunId(cwd);
  if (!id) return fail("no active jam run in this project");
  const dir = runDir(cwd, id);
  if (!fs.existsSync(dir)) return fail(`active run ${id} has no run directory`);
  appendLedger(dir, { at: new Date().toISOString(), type: "review-round", phase, round, blockers, ...(notes ? { notes } : {}) });
  process.stdout.write(`recorded review-round ${phase} #${round} (blockers=${blockers})\n`);
}

function cmdHelp(cwd, positional) {
  const name = positional[0];
  if (name) {
    const text = renderCommandHelp(COMMAND_META, name);
    if (text === null) {
      process.stderr.write(`unknown command: ${name}\n\n`);
      process.stdout.write(renderHelp(COMMAND_META));
      process.exit(1);
    }
    process.stdout.write(text);
    return;
  }
  process.stdout.write(renderHelp(COMMAND_META));
}

const HANDLERS = {
  doctor: cmdDoctor,
  init: cmdInit,
  start: cmdStart,
  ground: cmdGround,
  converge: cmdConverge,
  specify: cmdSpecify,
  build: cmdBuild,
  next: cmdNext,
  status: cmdStatus,
  resume: cmdResume,
  "render-digest": cmdRenderDigest,
  approve: cmdApprove,
  reject: cmdReject,
  rewind: cmdRewind,
  dial: cmdDial,
  "add-gate": cmdAddGate,
  evidence: cmdEvidence,
  steer: cmdSteer,
  cancel: cmdCancel,
  "propose-action": cmdProposeAction,
  ratify: cmdRatify,
  diagnose: cmdDiagnose,
  verify: cmdVerify,
  advance: cmdAdvance,
  "codex-run": cmdCodexRun,
  reconcile: cmdReconcile,
  "codex-resume": cmdCodexResume,
  "codex-status": cmdCodexStatus,
  plan: cmdPlan,
  "promote-sprint": cmdPromoteSprint,
  sprint: cmdSprint,
  audit: cmdAudit,
  report: cmdReport,
  "review-round": cmdReviewRound,
  help: cmdHelp,
};

function assertRegistryParity() {
  const meta = Object.keys(COMMAND_META).sort().join(",");
  const handlers = Object.keys(HANDLERS).sort().join(",");
  if (meta !== handlers) throw new Error(`command registry drift:\n meta:     ${meta}\n handlers: ${handlers}`);
}

export async function main(argv = process.argv.slice(2), cwd = process.cwd()) {
  const [sub, ...rest] = argv;
  const { positional, flags } = parseFlags(rest);
  assertRegistryParity();
  if (!sub || sub === "-h" || sub === "--help") return cmdHelp(cwd, [], flags);
  const cmd = HANDLERS[sub];
  if (!cmd) {
    process.stderr.write(`unknown subcommand: ${sub}\n\n`);
    process.stdout.write(renderHelp(COMMAND_META));
    process.exit(1);
  }
  return cmd(cwd, positional, flags);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => fail(e && e.message ? e.message : String(e)));
}
