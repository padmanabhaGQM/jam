#!/usr/bin/env node
// Fake `codex exec` for jam tests. Emulates the --json event stream + -o last-message.
// Modes via JAM_FAKE_MODE: complete (default) | hang | interrupt | malformed.
import fs from "node:fs";
import process from "node:process";

const argv = process.argv.slice(2);
const cdIdx = argv.indexOf("--cd");
if (cdIdx >= 0 && argv[cdIdx + 1]) { try { process.chdir(argv[cdIdx + 1]); } catch {} }
if (process.env.JAM_FAKE_EDIT) {
  const [rel, ...rest] = process.env.JAM_FAKE_EDIT.split(":");
  try { fs.appendFileSync(rel, rest.join(":") + "\n"); } catch {}
}
const isResume = argv[0] === "exec" && argv[1] === "resume";
const oIdx = argv.indexOf("-o");
const lastMsg = oIdx >= 0 ? argv[oIdx + 1] : null;
const sessionId = isResume
  ? argv[oIdx + 2]
  : (process.env.JAM_FAKE_SESSION_ID || "fake-session-1");
const mode = process.env.JAM_FAKE_MODE || "complete";

// Drain stdin so the writer's pipe does not block.
try { fs.readFileSync(0); } catch {}

function emit(obj) { process.stdout.write(JSON.stringify(obj) + "\n"); }

if (mode === "malformed") {
  process.stdout.write("this is not json\n");
  process.exit(0);
}

if (!(isResume && process.env.JAM_FAKE_NO_THREAD_STARTED === "1")) {
  emit({ type: "thread.started", thread_id: sessionId });
}

if (mode === "interrupt") {
  process.exit(1); // mid-turn exit: no turn.completed, no last message
}

if (mode === "hang") {
  setTimeout(() => process.exit(0), 60000); // never completes within a test timeout
} else {
  emit({ type: "item.completed", text: "fake body" });
  emit({ type: "turn.completed", status: "completed" });
  if (lastMsg) fs.writeFileSync(lastMsg, `FINAL: fake message for ${sessionId}\n`);
  process.exit(0);
}
