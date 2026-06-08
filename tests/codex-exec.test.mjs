import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { codexStart, codexResume, codexWait } from "../plugins/jam/scripts/lib/codex/exec.mjs";

const FAKE = fileURLToPath(new URL("./fixtures/fake-codex.mjs", import.meta.url));
function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), "jam-exec-")); }

test("codexWait returns completed from a finished event log (no process)", async () => {
  const dir = tmp();
  const log = path.join(dir, "e.jsonl");
  const last = path.join(dir, "l.md");
  fs.writeFileSync(log, JSON.stringify({ type: "thread.started", thread_id: "s1" }) + "\n" + JSON.stringify({ type: "turn.completed" }) + "\n");
  fs.writeFileSync(last, "FINAL: hello");
  const r = await codexWait({ eventLog: log, lastMsg: last, timeoutMs: 1000, pollMs: 20 });
  assert.equal(r.status, "completed");
  assert.equal(r.sessionId, "s1");
  assert.match(r.lastMessage, /hello/);
});

test("codexWait times out (NOT killed) when no completion appears", async () => {
  const dir = tmp();
  const log = path.join(dir, "e.jsonl");
  fs.writeFileSync(log, JSON.stringify({ type: "thread.started", thread_id: "s2" }) + "\n");
  const r = await codexWait({ eventLog: log, lastMsg: path.join(dir, "l.md"), timeoutMs: 200, pollMs: 20 });
  assert.equal(r.status, "timed_out");
  assert.equal(r.sessionId, "s2");
});

test("codexStart against fake-codex completes and is captured by codexWait", async () => {
  const dir = tmp();
  const eventLog = path.join(dir, "e.jsonl");
  const lastMsg = path.join(dir, "l.md");
  codexStart({ prompt: "diagnose", cwd: dir, codexBin: FAKE, eventLog, lastMsg });
  const r = await codexWait({ eventLog, lastMsg, timeoutMs: 5000, pollMs: 30 });
  assert.equal(r.status, "completed");
  assert.equal(r.sessionId, "fake-session-1");
  assert.match(r.lastMessage, /FINAL:/);
});

test("hang fake -> codexWait times out; the engine never kills", async () => {
  const dir = tmp();
  const eventLog = path.join(dir, "e.jsonl");
  const lastMsg = path.join(dir, "l.md");
  process.env.JAM_FAKE_MODE = "hang";
  const { pid } = codexStart({ prompt: "x", cwd: dir, codexBin: FAKE, eventLog, lastMsg });
  const r = await codexWait({ eventLog, lastMsg, timeoutMs: 400, pollMs: 30 });
  delete process.env.JAM_FAKE_MODE;
  assert.equal(r.status, "timed_out");
  try { process.kill(pid); } catch {} // TEST cleanup of the detached fake — NOT done by the engine
});

test("codexResume against fake-codex completes (resume path)", async () => {
  const dir = tmp();
  const eventLog = path.join(dir, "e.jsonl");
  const lastMsg = path.join(dir, "l.md");
  codexResume({ sessionId: "resume-sid", prompt: "reply", codexBin: FAKE, eventLog, lastMsg });
  const r = await codexWait({ eventLog, lastMsg, timeoutMs: 5000, pollMs: 30 });
  assert.equal(r.status, "completed");
  assert.equal(r.sessionId, "resume-sid");
});

test("a bad codex binary does not crash; the turn times out", async () => {
  const dir = tmp();
  const eventLog = path.join(dir, "e.jsonl");
  const lastMsg = path.join(dir, "l.md");
  assert.doesNotThrow(() => codexStart({ prompt: "x", cwd: dir, codexBin: "/nonexistent/jam-codex", eventLog, lastMsg }));
  const r = await codexWait({ eventLog, lastMsg, timeoutMs: 300, pollMs: 30 });
  assert.equal(r.status, "timed_out");
});
