import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { sessionIdFromEventLog, hasTurnCompleted, classifyTurn, locateTranscript } from "../plugins/jam/scripts/lib/codex/session.mjs";

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), "jam-sess-")); }
function writeLog(lines) { const p = path.join(tmp(), "events.jsonl"); fs.writeFileSync(p, lines.map(o => JSON.stringify(o)).join("\n") + "\n"); return p; }

test("sessionIdFromEventLog reads thread.started.thread_id", () => {
  const log = writeLog([{ type: "thread.started", thread_id: "abc" }, { type: "turn.completed" }]);
  assert.equal(sessionIdFromEventLog(log), "abc");
});

test("hasTurnCompleted detects completion", () => {
  assert.equal(hasTurnCompleted(writeLog([{ type: "thread.started", thread_id: "x" }, { type: "turn.completed" }])), true);
  assert.equal(hasTurnCompleted(writeLog([{ type: "thread.started", thread_id: "x" }])), false);
});

test("classifyTurn: orphaned | incomplete | completed", () => {
  assert.equal(classifyTurn({ eventLog: writeLog([{ type: "noise" }]) }), "orphaned");
  assert.equal(classifyTurn({ eventLog: writeLog([{ type: "thread.started", thread_id: "x" }]) }), "incomplete");
  assert.equal(classifyTurn({ eventLog: writeLog([{ type: "thread.started", thread_id: "x" }, { type: "turn.completed" }]) }), "completed");
});

test("missing/garbled log is safe", () => {
  assert.equal(sessionIdFromEventLog("/no/such/file"), null);
  const bad = path.join(tmp(), "e.jsonl"); fs.writeFileSync(bad, "not json\n");
  assert.equal(hasTurnCompleted(bad), false);
});

test("locateTranscript finds a rollout file by session id", () => {
  const home = tmp();
  const dir = path.join(home, "sessions", "2026", "06", "08");
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, "rollout-2026-06-08T00-00-00-sid123.jsonl");
  fs.writeFileSync(f, "{}\n");
  assert.equal(locateTranscript("sid123", { codexHome: home }), f);
  assert.equal(locateTranscript("nope", { codexHome: home }), null);
});
