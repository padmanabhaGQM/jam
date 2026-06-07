import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { runVerification, captureEvidence } from "../plugins/jam/scripts/lib/evidence.mjs";

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "jam-ev-"));
}

test("runVerification captures exit 0 for a passing command", () => {
  const r = runVerification("exit 0", tmpDir());
  assert.equal(r.exitCode, 0);
});

test("runVerification captures non-zero exit for a failing command", () => {
  const r = runVerification("exit 3", tmpDir());
  assert.equal(r.exitCode, 3);
});

test("runVerification captures stdout", () => {
  const r = runVerification("echo hello", tmpDir());
  assert.match(r.stdout, /hello/);
});

test("captureEvidence writes evidence/<sprintId>.json", () => {
  const dir = tmpDir();
  const p = captureEvidence(dir, "sprint-0", { exitCode: 0, command: "x" });
  assert.ok(fs.existsSync(p));
  const back = JSON.parse(fs.readFileSync(p, "utf8"));
  assert.equal(back.exitCode, 0);
});
