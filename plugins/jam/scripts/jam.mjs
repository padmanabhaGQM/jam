#!/usr/bin/env node
/**
 * jam.mjs — the jam run-control CLI. Drives the deterministic control surface.
 * Project root = process.cwd(); active run = the ACTIVE pointer under it.
 */
import process from "node:process";

import { readActiveRunId, runDir } from "./lib/paths.mjs";
import { readState } from "./lib/state.mjs";
import { createRun } from "./lib/actions.mjs";

function fail(msg) {
  process.stderr.write(msg + "\n");
  process.exit(1);
}

function parseFlags(args) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      flags[args[i].slice(2)] = args[i + 1];
      i++;
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

function main() {
  const [sub, ...rest] = process.argv.slice(2);
  const cwd = process.cwd();
  const { positional, flags } = parseFlags(rest);

  switch (sub) {
    case "start":
      return cmdStart(cwd, positional, flags);
    case "status":
      return cmdStatus(cwd);
    default:
      return fail(`unknown subcommand: ${sub ?? "(none)"}`);
  }
}

main();
