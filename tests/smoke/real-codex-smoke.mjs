#!/usr/bin/env node
// Opt-in real-codex smoke. SKIPS unless JAM_REAL_CODEX_SMOKE=1.
//
// SAFETY (hard invariants):
//  - NEVER kills any process. No process.kill, no SIGTERM, no kill/pkill. A
//    timeout is surfaced and left resumable. This respects the user's live
//    Codex jobs and the app-server bound to other repos.
//  - Spawns its OWN `codex exec` in an isolated temp cwd; never attaches to or
//    signals any existing Codex process.
//  - Runs against the real $CODEX_HOME but only ADDS one rollout file.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  sessionIdFromEventLog,
  classifyTurn,
  locateTranscript,
} from "../../plugins/jam/scripts/lib/codex/session.mjs";
import { evaluateSmoke } from "../../plugins/jam/scripts/lib/codex/smoke.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(HERE, "../../plugins/jam/scripts/jam.mjs");
const EXPECT_TOKEN = "JAM_SMOKE_OK";

if (process.env.JAM_REAL_CODEX_SMOKE !== "1") {
  process.stdout.write("SKIP: set JAM_REAL_CODEX_SMOKE=1 to run the real-codex smoke\n");
  process.exit(0);
}

const projDir = fs.mkdtempSync(path.join(os.tmpdir(), "jam-smoke-proj-"));
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "jam-smoke-out-"));
const promptFile = path.join(projDir, "prompt.md");
fs.writeFileSync(promptFile, "Reply with exactly this and nothing else: JAM_SMOKE_OK\n");

const timeoutMs = Number(process.env.JAM_SMOKE_TIMEOUT) || 120000;
const run = spawnSync(
  process.execPath,
  [CLI, "codex-run", "--prompt-file", promptFile, "--timeout", String(timeoutMs), "--out-dir", outDir],
  { cwd: projDir, encoding: "utf8", timeout: timeoutMs + 30000 },
);

const stdout = run.stdout || "";
const status = (stdout.match(/status:\s*(\S+)/) || [])[1] || "(unknown)";

if (status === "timed_out") {
  const sid = (stdout.match(/session:\s*(\S+)/) || [])[1] || "(unknown)";
  process.stdout.write(
    `REAL-CODEX SMOKE: INCONCLUSIVE (timed_out)\n` +
    `the Codex process was NOT killed; resume with session ${sid}\n` +
    `out-dir: ${outDir}\n`,
  );
  process.exit(2);
}

const eventLog = path.join(outDir, "events.jsonl");
const lastMsgFile = path.join(outDir, "last.md");

let eventTypes = [];
if (fs.existsSync(eventLog)) {
  eventTypes = [
    ...new Set(
      fs.readFileSync(eventLog, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => { try { return JSON.parse(l).type; } catch { return null; } })
        .filter(Boolean),
    ),
  ];
}
let lastMsg = "";
try { lastMsg = fs.readFileSync(lastMsgFile, "utf8"); } catch { lastMsg = ""; }

const haveLog = fs.existsSync(eventLog);
const sessionId = haveLog ? sessionIdFromEventLog(eventLog) : null;
const classification = haveLog ? classifyTurn({ eventLog }) : "orphaned";
const transcriptPath = sessionId ? locateTranscript(sessionId) : null;

const observation = { status, eventTypes, sessionId, classification, lastMsg, expectToken: EXPECT_TOKEN, transcriptPath };
const { ok, failures } = evaluateSmoke(observation);

if (ok) {
  process.stdout.write(
    `REAL-CODEX SMOKE: CONFIRMED\n` +
    `session: ${sessionId}\ntranscript: ${transcriptPath}\nout-dir: ${outDir}\n`,
  );
  process.exit(0);
}

process.stdout.write(
  `REAL-CODEX SMOKE: FAILED\n` +
  `diagnostic:\n` +
  `  status: ${status}\n` +
  `  eventTypes: ${JSON.stringify(eventTypes)}\n` +
  `  sessionId: ${sessionId}\n` +
  `  classification: ${classification}\n` +
  `  lastMsg(first 200): ${JSON.stringify(lastMsg.slice(0, 200))}\n` +
  `  transcriptPath: ${transcriptPath}\n` +
  `failures:\n${failures.map((f) => "  - " + f).join("\n")}\n` +
  `out-dir: ${outDir}\n`,
);
process.exit(1);
