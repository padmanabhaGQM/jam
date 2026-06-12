#!/usr/bin/env node
// session-start-hook.mjs — announce an active jam run at session start.
// Contract: read JSON {cwd} from stdin; if the project has an active run, print where it
// stands (renderStatus) + the next action (deriveNextAction); otherwise stay SILENT.
// Fail-safe: any error => silent exit 0 (a hook must never break session start). Read-only.
import fs from "node:fs";
import process from "node:process";
import { readActiveRunId, runDir } from "./lib/paths.mjs";
import { readState } from "./lib/state.mjs";
import { deriveNextAction } from "./lib/resume.mjs";
import { renderStatus } from "./lib/render-status.mjs";

try {
  let cwd = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  try { const raw = fs.readFileSync(0, "utf8").trim(); if (raw) cwd = JSON.parse(raw).cwd ?? cwd; } catch {}
  const id = readActiveRunId(cwd);
  if (id) {
    const state = readState(runDir(cwd, id));
    process.stdout.write(`jam run ${id} is active in this project\n`);
    process.stdout.write(renderStatus(state, id));
    process.stdout.write(`\nnext: ${deriveNextAction(state).message}\n`);
  }
} catch {}
process.exit(0);
