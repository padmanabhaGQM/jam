import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Create a temp CODEX_HOME containing a rollout file locateTranscript() will
// match for sessionId.
export function fakeCodexHome(sessionId, body = '{"type":"thread.started"}\n') {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "jam-codexhome-"));
  const dir = path.join(home, "sessions", "2026", "06", "10");
  fs.mkdirSync(dir, { recursive: true });
  const transcriptPath = path.join(dir, `rollout-2026-06-10T00-00-00-${sessionId}.jsonl`);
  fs.writeFileSync(transcriptPath, body);
  return { codexHome: home, transcriptPath };
}
