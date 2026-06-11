import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { sessionIdFromEventLog, hasTurnCompleted } from "./session.mjs";

function resolveBin(codexBin) { return codexBin || process.env.JAM_CODEX_BIN || "codex"; }

function spawnDetached(bin, args, { prompt, eventLog, cwd }) {
  fs.mkdirSync(path.dirname(eventLog), { recursive: true });
  const out = fs.openSync(eventLog, "a");
  const child = spawn(bin, args, { cwd, detached: true, stdio: ["pipe", out, out] });
  // A bad/missing binary (e.g. misconfigured JAM_CODEX_BIN) emits 'error' asynchronously.
  // Swallow it with a breadcrumb so the CLI never crashes; codexWait will simply time out.
  // (Never kill: we attach handlers, we do not terminate anything.)
  child.on("error", (e) => {
    try { fs.appendFileSync(eventLog, JSON.stringify({ type: "spawn.error", message: String(e && e.message) }) + "\n"); } catch {}
  });
  if (child.stdin) {
    child.stdin.on("error", () => {});
    if (prompt != null) child.stdin.write(prompt);
    child.stdin.end();
  }
  child.unref();
  fs.closeSync(out);
  return { pid: child.pid, eventLog };
}

export function codexStart({ prompt, cwd, sandbox = "workspace-write", codexBin, eventLog, lastMsg }) {
  const args = ["exec", "--json", "--sandbox", sandbox, "--cd", cwd, "-o", lastMsg, "-"];
  return { ...spawnDetached(resolveBin(codexBin), args, { prompt, eventLog, cwd }), lastMsg };
}

export function codexResume({ sessionId, prompt, codexBin, eventLog, lastMsg }) {
  const args = ["exec", "resume", "--json", "-o", lastMsg, sessionId, "-"];
  return { ...spawnDetached(resolveBin(codexBin), args, { prompt, eventLog }), lastMsg };
}

function readLast(p) { try { return fs.readFileSync(p, "utf8"); } catch { return null; } }

// Polls for completion. On timeout it STOPS WAITING and returns timed_out.
// It MUST NOT kill or signal the Codex process (user rule: never kill Codex).
export async function codexWait({ eventLog, lastMsg, timeoutMs = 120000, pollMs = 100 }) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (hasTurnCompleted(eventLog)) {
      // turn.completed may be flushed slightly before the -o last-message file with a real
      // codex binary; give the file a brief grace window before returning.
      let lastMessage = readLast(lastMsg);
      const graceUntil = Date.now() + Math.max(pollMs * 3, 300);
      while (lastMessage == null && Date.now() < graceUntil) {
        await new Promise((r) => setTimeout(r, pollMs));
        lastMessage = readLast(lastMsg);
      }
      return { status: "completed", sessionId: sessionIdFromEventLog(eventLog), lastMessage };
    }
    if (Date.now() >= deadline) {
      return { status: "timed_out", sessionId: sessionIdFromEventLog(eventLog) };
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
}
