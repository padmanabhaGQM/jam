#!/usr/bin/env node
/**
 * gate-hook.mjs — Stop-hook gate enforcement.
 * Blocks session-stop until the active jam run's current gate is satisfied.
 * Contract: read JSON {cwd,...} from stdin; block => {"decision":"block","reason"} on stdout;
 * allow => no output. Fail-safe: any error or no-run => allow (never wedge a session).
 */
import fs from "node:fs";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { readActiveRunId, runDir } from "./lib/paths.mjs";
import { readState } from "./lib/state.mjs";
import { currentBlockingGate, evaluateGate } from "./lib/gate.mjs";

function readHookInput() {
  try {
    const raw = fs.readFileSync(0, "utf8").trim();
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function decorateReason(reason) {
  return typeof reason === "string"
    ? reason.replace(/\bjam approve (\S+)/g, "jam approve $1 (in Claude Code: /jam:approve $1)")
    : reason;
}

export function decisionForCwd(cwd) {
  const runId = readActiveRunId(cwd);
  if (!runId) return null;

  let state;
  try {
    state = readState(runDir(cwd, runId));
  } catch (err) {
    return {
      decision: "block",
      reason: `jam run ${runId} state is unreadable (${String(err?.message ?? err)}). Repair docs/superpowers/loop-runs/${runId}/state.json or run /jam:cancel.`
    };
  }

  const blocking = currentBlockingGate(state);
  if (!blocking) return null;

  const { reason } = evaluateGate(state, blocking);
  return { decision: "block", reason: `jam gate not satisfied — ${reason}` };
}

function emitDecision(payload) {
  const reason = decorateReason(payload.reason);
  process.stdout.write(JSON.stringify({ ...payload, reason }) + "\n");
}

function main() {
  const input = readHookInput();
  const cwd = input.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const decision = decisionForCwd(cwd);
  if (decision) emitDecision(decision);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    // fail-safe: never wedge the session on hook error
    process.stderr.write(String(error?.message ?? error) + "\n");
  }
}
