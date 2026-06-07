#!/usr/bin/env node
/**
 * gate-hook.mjs — Stop-hook gate enforcement.
 * Blocks session-stop until the active jam run's current gate is satisfied.
 * Contract: read JSON {cwd,...} from stdin; block => {"decision":"block","reason"} on stdout;
 * allow => no output. Fail-safe: any error or no-run => allow (never wedge a session).
 */
import fs from "node:fs";
import process from "node:process";

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

function emitDecision(payload) {
  process.stdout.write(JSON.stringify(payload) + "\n");
}

function main() {
  const input = readHookInput();
  const cwd = input.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();

  const runId = readActiveRunId(cwd);
  if (!runId) return; // no active run → allow

  let state;
  try {
    state = readState(runDir(cwd, runId));
  } catch (err) {
    // An ACTIVE run exists but its state is unreadable/corrupt. Do NOT silently
    // pass an unsatisfied run — surface it and block, with an escape hatch.
    // (Truly unexpected hook bugs still fail open via the outer catch below,
    // so a session is never wedged by a hook malfunction.)
    emitDecision({
      decision: "block",
      reason: `jam run ${runId} state is unreadable (${String(err?.message ?? err)}). Repair docs/superpowers/loop-runs/${runId}/state.json or run /jam:cancel.`
    });
    return;
  }

  const blocking = currentBlockingGate(state);
  if (!blocking) return; // all gates satisfied → allow

  const { reason } = evaluateGate(state, blocking);
  emitDecision({ decision: "block", reason: `jam gate not satisfied — ${reason}` });
}

try {
  main();
} catch (error) {
  // fail-safe: never wedge the session on hook error
  process.stderr.write(String(error?.message ?? error) + "\n");
}
