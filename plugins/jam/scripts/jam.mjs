#!/usr/bin/env node
/**
 * jam.mjs — the jam run-control CLI. Drives the deterministic control surface.
 * Project root = process.cwd(); active run = the ACTIVE pointer under it.
 */
import process from "node:process";
import fs from "node:fs";

import { readActiveRunId, runDir } from "./lib/paths.mjs";
import { readState } from "./lib/state.mjs";
import { createRun, addGate, recordDigest, recordApproval, recordEvidence } from "./lib/actions.mjs";

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

function main() {
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
    default:
      return fail(`unknown subcommand: ${sub ?? "(none)"}`);
  }
}

main();
