import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { appendLedger, readLedger, ledgerPath } from "../plugins/jam/scripts/lib/ledger.mjs";

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "jam-led-"));
}

test("readLedger returns [] when no ledger exists", () => {
  assert.deepEqual(readLedger(tmpDir()), []);
});

test("appendLedger appends JSONL entries that readLedger reconstructs in order", () => {
  const dir = tmpDir();
  appendLedger(dir, { at: "t1", type: "run-created", runId: "r1" });
  appendLedger(dir, { at: "t2", type: "approval", gateId: "ALIGN" });
  const entries = readLedger(dir);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].type, "run-created");
  assert.equal(entries[1].gateId, "ALIGN");
  const raw = fs.readFileSync(ledgerPath(dir), "utf8").trim().split("\n");
  assert.equal(raw.length, 2);
});
