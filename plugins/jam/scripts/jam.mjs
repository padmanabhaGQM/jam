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

import { readActiveRunId, runDir } from "./lib/paths.mjs";
import { codexStart, codexResume, codexWait } from "./lib/codex/exec.mjs";
import { classifyTurn, sessionIdFromEventLog, locateTranscript } from "./lib/codex/session.mjs";
import { readState } from "./lib/state.mjs";
import { createRun, addGate, recordDigest, recordApproval, recordEvidence } from "./lib/actions.mjs";
import { addSteering, cancelRun, recordVerification } from "./lib/control.mjs";
import { setGoal } from "./lib/goal.mjs";
import { advanceRun } from "./lib/phases.mjs";
import { recordPlan } from "./lib/plan.mjs";
import { startSprint, verifySprint, finishSprint, bindCodexSession } from "./lib/sprint.mjs";

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

function requireActiveRun(cwd) {
  const runId = readActiveRunId(cwd);
  if (!runId) fail("no active jam run in this project (run `jam start <topic>` first)");
  return { runId, dir: runDir(cwd, runId) };
}

function genRunId() {
  return `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function cmdStart(cwd, positional, flags) {
  const topic = positional.join(" ").trim();
  if (!topic) fail("usage: jam start <topic>");
  const runId = flags["run-id"] || genRunId();
  createRun({ projectRoot: cwd, runId, topic });
  process.stdout.write(`started jam run ${runId} (phase ALIGN, gate ALIGN: pending)\n`);
}

function cmdStatus(cwd) {
  const { runId, dir } = requireActiveRun(cwd);
  const state = readState(dir);
  const lines = [`run ${runId} — phase ${state.phase}`];
  for (const [id, g] of Object.entries(state.gates)) {
    lines.push(`  gate ${id}: ${g.mode}/${g.status}`);
  }
  const active = state.steeringDirectives.filter((d) => d.status === "active");
  if (active.length) {
    lines.push(`  active directives: ${active.map((d) => d.id).join(", ")}`);
  }
  if (state.plan) {
    lines.push(`  verify: ${state.plan.verifyCmd}`);
    for (const sp of state.plan.sprints) {
      lines.push(`  sprint ${sp.id}: ${sp.status} — ${sp.title}`);
      for (const cs of sp.codexSessions ?? []) {
        lines.push(`      codex: ${cs.sessionId} (${cs.transcriptPath ? "transcript" : "no-transcript"})`);
      }
    }
  }
  process.stdout.write(lines.join("\n") + "\n");
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

function cmdCancel(cwd) {
  const { dir } = requireActiveRun(cwd);
  cancelRun({ projectRoot: cwd, runDir: dir });
  process.stdout.write("jam run cancelled\n");
}

function cmdDiagnose(cwd, positional, flags) {
  const topic = positional.join(" ").trim();
  if (!topic) fail("usage: jam diagnose <topic> --goal <file>  (or --goal-codex <goalId>)");
  let text, source;
  if (flags.goal) {
    try { text = fs.readFileSync(flags.goal, "utf8"); source = `file:${flags.goal}`; }
    catch (e) { return fail(`cannot read goal file: ${e.message}`); }
  } else if (flags["goal-codex"]) {
    const r = spawnSync("python3", ["-c",
      "import sqlite3,sys,os;c=sqlite3.connect(os.path.join(os.path.expanduser('~'),'.codex','goals_1.sqlite'));"+
      "r=c.execute('select objective from thread_goals where goal_id=?',(sys.argv[1],)).fetchone();"+
      "print(r[0] if r else '')", flags["goal-codex"]], { encoding: "utf8" });
    text = (r.stdout || "").trim(); source = `codex:${flags["goal-codex"]}`;
  } else {
    return fail("usage: jam diagnose <topic> --goal <file>  (or --goal-codex <goalId>)");
  }
  if (!text || !text.trim()) {
    return fail("goal is empty; provide a non-empty --goal <file> or a valid --goal-codex <goalId>");
  }
  const runId = flags["run-id"] || genRunId();
  createRun({ projectRoot: cwd, runId, topic, mode: "repair" });
  setGoal({ runDir: runDir(cwd, runId), text, source });
  process.stdout.write(`started repair run ${runId} (phase DIAGNOSE, gate DIAGNOSE: pending)\n`);
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
  bindCodexSession({ runDir: dir, sprintId: flags.sprint, sessionId, transcriptPath });
  process.stdout.write(`bound session ${sessionId} to sprint ${flags.sprint} (transcript: ${transcriptPath ?? "none"})\n`);
}

async function cmdCodexRun(cwd, positional, flags) {
  if (!flags["prompt-file"]) return fail("usage: jam codex-run --prompt-file <f> [--timeout <ms>] [--cwd <dir>] [--out-dir <dir>]");
  let prompt;
  try { prompt = fs.readFileSync(flags["prompt-file"], "utf8"); } catch (e) { return fail(`cannot read prompt file: ${e.message}`); }
  const outDir = flags["out-dir"] || fs.mkdtempSync(path.join(os.tmpdir(), "jam-codex-"));
  fs.mkdirSync(outDir, { recursive: true });
  const eventLog = path.join(outDir, "events.jsonl");
  const lastMsg = path.join(outDir, "last.md");
  codexStart({ prompt, cwd: flags.cwd || cwd, eventLog, lastMsg });
  const timeoutMs = Number(flags.timeout) || 120000;
  const r = await codexWait({ eventLog, lastMsg, timeoutMs });
  process.stdout.write(`status: ${r.status}\nsession: ${r.sessionId ?? "(none)"}\nout-dir: ${outDir}\n`);
  if (r.status === "completed") process.stdout.write(`message:\n${r.lastMessage ?? ""}\n`);
  else process.stdout.write(`Codex turn did not complete within ${timeoutMs}ms. It may still be running (NOT killed). Resume with: jam codex-resume ${r.sessionId ?? "<id>"} --prompt-file <reply>\n`);
  maybeBindSprint({ cwd, flags, status: r.status, sessionId: r.sessionId });
}

async function cmdCodexResume(cwd, positional, flags) {
  const sessionId = positional[0];
  if (!sessionId || !flags["prompt-file"]) return fail("usage: jam codex-resume <sessionId> --prompt-file <f> [--timeout <ms>] [--out-dir <dir>]");
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

async function main() {
  const [sub, ...rest] = process.argv.slice(2);
  const cwd = process.cwd();
  const { positional, flags } = parseFlags(rest);

  switch (sub) {
    case "start":
      return cmdStart(cwd, positional, flags);
    case "status":
      return cmdStatus(cwd);
    case "render-digest":
      return cmdRenderDigest(cwd, positional, flags);
    case "approve":
      return cmdApprove(cwd, positional);
    case "add-gate":
      return cmdAddGate(cwd, positional, flags);
    case "evidence":
      return cmdEvidence(cwd, positional, flags);
    case "steer":
      return cmdSteer(cwd, positional);
    case "cancel":
      return cmdCancel(cwd);
    case "diagnose":
      return cmdDiagnose(cwd, positional, flags);
    case "verify":
      return cmdVerify(cwd, positional, flags);
    case "advance":
      return cmdAdvance(cwd);
    case "codex-run":
      return cmdCodexRun(cwd, positional, flags);
    case "codex-resume":
      return cmdCodexResume(cwd, positional, flags);
    case "codex-status":
      return cmdCodexStatus(cwd, positional, flags);
    case "plan":
      return cmdPlan(cwd, positional, flags);
    case "sprint":
      return cmdSprint(cwd, positional, flags);
    default:
      return fail(`unknown subcommand: ${sub ?? "(none)"}`);
  }
}

main().catch((e) => fail(e && e.message ? e.message : String(e)));
