import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateSmoke } from "../plugins/jam/scripts/lib/codex/smoke.mjs";

function good() {
  return {
    status: "completed",
    eventTypes: ["thread.started", "turn.started", "turn.completed"],
    sessionId: "sess-1",
    classification: "completed",
    lastMsg: "JAM_SMOKE_OK",
    expectToken: "JAM_SMOKE_OK",
    transcriptPath: "/home/x/.codex/sessions/rollout-2026-sess-1.jsonl",
  };
}

function failuresFor(overrides) {
  return evaluateSmoke({ ...good(), ...overrides }).failures.join(" | ");
}

test("a fully-good observation passes with no failures", () => {
  const r = evaluateSmoke(good());
  assert.equal(r.ok, true);
  assert.deepEqual(r.failures, []);
});

test("status not completed fails", () => {
  assert.match(failuresFor({ status: "timed_out" }), /status not completed/);
});

test("missing thread.started fails", () => {
  assert.match(failuresFor({ eventTypes: ["turn.completed"] }), /thread\.started/);
});

test("missing turn.completed fails", () => {
  assert.match(failuresFor({ eventTypes: ["thread.started"] }), /turn\.completed/);
});

test("null session id fails", () => {
  assert.match(failuresFor({ sessionId: null }), /no session id/);
});

test("classification not completed fails", () => {
  assert.match(failuresFor({ classification: "orphaned" }), /classifyTurn=orphaned/);
});

test("empty last message fails (and does not also report missing token)", () => {
  const f = failuresFor({ lastMsg: "  " });
  assert.match(f, /last-message \(-o\) file empty/);
  assert.doesNotMatch(f, /missing expected token/);
});

test("non-empty last message without the token fails on the token", () => {
  assert.match(failuresFor({ lastMsg: "hello world" }), /missing expected token JAM_SMOKE_OK/);
});

test("null transcript path fails", () => {
  assert.match(failuresFor({ transcriptPath: null }), /transcript not locatable/);
});

test("multiple violations accumulate", () => {
  const r = evaluateSmoke({
    status: "x", eventTypes: [], sessionId: null, classification: "orphaned",
    lastMsg: "", expectToken: "JAM_SMOKE_OK", transcriptPath: null,
  });
  assert.equal(r.ok, false);
  assert.ok(r.failures.length >= 6);
});
