import fs from "node:fs";
import path from "node:path";

function parsed(eventLog) {
  let raw;
  try { raw = fs.readFileSync(eventLog, "utf8"); } catch { return []; }
  return raw.split("\n").filter((l) => l.trim()).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

export function sessionIdFromEventLog(eventLog) {
  const ev = parsed(eventLog).find((e) => e.type === "thread.started" && e.thread_id);
  return ev ? ev.thread_id : null;
}

export function hasTurnCompleted(eventLog) {
  return parsed(eventLog).some((e) => e.type === "turn.completed");
}

export function classifyTurn({ eventLog }) {
  const ev = parsed(eventLog);
  if (!ev.some((e) => e.type === "thread.started")) return "orphaned";
  if (ev.some((e) => e.type === "turn.completed")) return "completed";
  return "incomplete";
}

export function locateTranscript(sessionId, { codexHome } = {}) {
  const home = codexHome || process.env.CODEX_HOME || path.join(process.env.HOME || "", ".codex");
  for (const root of [path.join(home, "sessions"), path.join(home, "archived_sessions")]) {
    let files;
    try { files = fs.readdirSync(root, { recursive: true }); } catch { continue; }
    for (const f of files) {
      const name = String(f);
      if (name.includes("rollout") && name.includes(sessionId) && name.endsWith(".jsonl")) {
        return path.join(root, name);
      }
    }
  }
  return null;
}
