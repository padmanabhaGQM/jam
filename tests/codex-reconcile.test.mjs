import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { liveQuestionFromLast, reconcile } from "../plugins/jam/scripts/lib/codex/reconcile.mjs";

test("liveQuestionFromLast reads + trims the last-message file", () => {
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "jam-rec-")), "l.md");
  fs.writeFileSync(p, "  What is the boundary?  \n");
  assert.equal(liveQuestionFromLast(p), "What is the boundary?");
  assert.equal(liveQuestionFromLast("/no/file"), null);
});

test("reconcile matches identical (normalized) questions", () => {
  assert.deepEqual(reconcile({ localPending: "Q?", live: "  Q?  " }), { match: true });
});

test("reconcile flags a mismatch with a recovery object", () => {
  const r = reconcile({ localPending: "old Q", live: "new live Q" });
  assert.equal(r.match, false);
  assert.equal(r.recovery.type, "question_state_mismatch");
  assert.equal(r.recovery.preserved, true);
  assert.ok(r.recovery.nextAction);
});
