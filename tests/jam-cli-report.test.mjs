import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const CLI = fileURLToPath(new URL("../plugins/jam/scripts/jam.mjs", import.meta.url));
function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), "jam-rpt-")); }
function jam(cwd, args, env = {}) { return spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8", env: { ...process.env, ...env } }); }
function writeJSON(p, o) { fs.writeFileSync(p, JSON.stringify(o)); return p; }
function digestObj() {
  return { runId: "r1", phase: "DIAGNOSE", summary: "s", traceToArchitecture: { componentsTouched: ["A"], gapFromAgreed: null },
    decisions: [], globalMap: { mermaid: "graph TD; A-->B", currentPosition: "A", isLocallyScopedRisk: false }, coverage: { addressed: [], dropped: [] } };
}
function startRun(root) {
  jam(root, ["diagnose", "fix", "--goal", writeJSON(path.join(root, "g.txt"), { x: 1 }), "--run-id", "r1"]);
  jam(root, ["render-digest", "DIAGNOSE", "--file", writeJSON(path.join(root, "d.json"), digestObj())]);
  jam(root, ["approve", "DIAGNOSE"]); jam(root, ["advance"]);
}

test("jam report renders run/phases/audit and is STRICTLY read-only", () => {
  const root = tmp();
  startRun(root);
  const stateP = path.join(root, "docs", "superpowers", "loop-runs", "r1", "state.json");
  const ledgerP = path.join(root, "docs", "superpowers", "loop-runs", "r1", "ledger.jsonl");
  const stateBefore = fs.readFileSync(stateP, "utf8");
  const ledgerBefore = fs.readFileSync(ledgerP, "utf8");
  const r = jam(root, ["report"]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /run r1 — repair — VERIFY/);
  assert.match(r.stdout, /audit: /);
  assert.equal(fs.readFileSync(stateP, "utf8"), stateBefore);     // read-only pinned
  assert.equal(fs.readFileSync(ledgerP, "utf8"), ledgerBefore);
});

test("jam report --json emits the parseable structure; explicit unknown runId fails", () => {
  const root = tmp();
  startRun(root);
  const j = jam(root, ["report", "r1", "--json"]);
  assert.equal(j.status, 0);
  const obj = JSON.parse(j.stdout);
  assert.equal(obj.run.runId, "r1");
  assert.notEqual(jam(root, ["report", "nope"]).status, 0);
});

test("jam review-round appends an inert ledger entry; validation refuses bad input; report counts rounds", () => {
  const root = tmp();
  startRun(root);
  assert.equal(jam(root, ["review-round", "--phase", "VERIFY", "--round", "1", "--blockers", "4"]).status, 0);
  assert.equal(jam(root, ["review-round", "--phase", "VERIFY", "--round", "2", "--blockers", "0", "--notes", "clean"]).status, 0);
  assert.notEqual(jam(root, ["review-round", "--phase", "BOGUS", "--round", "1", "--blockers", "0"]).status, 0);
  assert.notEqual(jam(root, ["review-round", "--phase", "VERIFY", "--round", "-1", "--blockers", "0"]).status, 0);
  assert.notEqual(jam(root, ["review-round", "--phase", "VERIFY", "--round", "3", "--blockers", "-2"]).status, 0);
  assert.notEqual(jam(root, ["review-round", "--phase", "VERIFY", "--round", "3", "--blockers", "0", "--notes", "x".repeat(501)]).status, 0);
  for (const [label, args] of [
    ["empty blockers", ["review-round", "--phase", "VERIFY", "--round", "3", "--blockers", ""]],
    ["space-prefixed blockers", ["review-round", "--phase", "VERIFY", "--round", "3", "--blockers", " 2"]],
    ["hex blockers", ["review-round", "--phase", "VERIFY", "--round", "3", "--blockers", "0x2"]],
    ["exponent blockers", ["review-round", "--phase", "VERIFY", "--round", "3", "--blockers", "1e2"]],
    ["zero round", ["review-round", "--phase", "VERIFY", "--round", "0", "--blockers", "0"]],
    ["fractional round", ["review-round", "--phase", "VERIFY", "--round", "2.5", "--blockers", "0"]],
    ["bare blockers", ["review-round", "--phase", "VERIFY", "--round", "3", "--blockers"]],
    ["omitted blockers", ["review-round", "--phase", "VERIFY", "--round", "3"]],
  ]) {
    assert.notEqual(jam(root, args).status, 0, label);
  }
  const ledger = fs.readFileSync(path.join(root, "docs", "superpowers", "loop-runs", "r1", "ledger.jsonl"), "utf8");
  assert.equal((ledger.match(/"type":"review-round"/g) ?? []).length, 2);
  const rep = jam(root, ["report"]);
  assert.match(rep.stdout, /VERIFY 2 rounds \(rounds to zero: 2\)/);
});

test("review-round entries are audit-inert (audit unchanged after appending)", () => {
  const root = tmp();
  startRun(root);
  const before = jam(root, ["audit"]).stdout + jam(root, ["audit"]).stderr;
  jam(root, ["review-round", "--phase", "SLICE", "--round", "1", "--blockers", "3"]);
  const after = jam(root, ["audit"]).stdout + jam(root, ["audit"]).stderr;
  assert.equal(after, before);
});

test("jam report --all lists runs one line each and tolerates a corrupt run dir", () => {
  const root = tmp();
  startRun(root);
  const corrupt = path.join(root, "docs", "superpowers", "loop-runs", "broken");
  fs.mkdirSync(corrupt, { recursive: true });
  fs.writeFileSync(path.join(corrupt, "ledger.jsonl"), "{not json}\n");
  fs.writeFileSync(path.join(corrupt, "state.json"), "{not json}\n");
  const r = jam(root, ["report", "--all"]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /r1 .*repair.*VERIFY/);
  assert.match(r.stdout, /broken.*unreadable/);
});

test("jam report --md writes report.md into the run dir with wikilinks; state+ledger untouched", () => {
  const root = tmp();
  startRun(root);
  const rd = path.join(root, "docs", "superpowers", "loop-runs", "r1");
  const stateBefore = fs.readFileSync(path.join(rd, "state.json"), "utf8");
  const ledgerBefore = fs.readFileSync(path.join(rd, "ledger.jsonl"), "utf8");
  const r = jam(root, ["report", "r1", "--md"]);
  assert.equal(r.status, 0);
  const md = fs.readFileSync(path.join(rd, "report.md"), "utf8");
  assert.match(md, /# jam run r1/);
  assert.match(md, /audit:/);
  assert.equal(fs.readFileSync(path.join(rd, "state.json"), "utf8"), stateBefore);     // the ONLY write is report.md
  assert.equal(fs.readFileSync(path.join(rd, "ledger.jsonl"), "utf8"), ledgerBefore);
});

test("jam report refuses --md and --json together without writing report.md", () => {
  const root = tmp();
  startRun(root);
  const rd = path.join(root, "docs", "superpowers", "loop-runs", "r1");
  const r = jam(root, ["report", "r1", "--md", "--json"]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /report: --md and --json are mutually exclusive/);
  assert.equal(fs.existsSync(path.join(rd, "report.md")), false);
});

test("report --md links spec/plan wikilinks when matching docs exist", () => {
  const root = tmp();
  startRun(root);
  fs.mkdirSync(path.join(root, "docs", "superpowers", "specs"), { recursive: true });
  fs.writeFileSync(path.join(root, "docs", "superpowers", "specs", "2026-01-01-r1-design.md"), "# spec");
  const rd = path.join(root, "docs", "superpowers", "loop-runs", "r1");
  jam(root, ["report", "r1", "--md"]);
  assert.match(fs.readFileSync(path.join(rd, "report.md"), "utf8"), /\[\[2026-01-01-r1-design\]\]/);
});
