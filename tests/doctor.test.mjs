import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateDoctor } from "../plugins/jam/scripts/lib/doctor.mjs";

const GOOD = {
  nodeVersion: "20.11.0", gitOk: true,
  codexBin: "codex", codexOk: true, codexAuthOk: true,
  inGitRepo: true, hasHead: true,
  pluginVersion: "0.19.0", packageVersion: "0.19.0",
};

test("doctor: all-good probes → every check ok, exit-ok", () => {
  const r = evaluateDoctor(GOOD);
  assert.equal(r.checks.length, 6);
  assert.ok(r.checks.every((c) => c.level === "ok"));
  assert.equal(r.ok, true);
});

test("doctor: old node + missing codex are FAILS with actionable fixes", () => {
  const r = evaluateDoctor({ ...GOOD, nodeVersion: "16.20.0", codexOk: false });
  const node = r.checks.find((c) => c.id === "node");
  const codex = r.checks.find((c) => c.id === "codex-bin");
  assert.equal(node.level, "fail");
  assert.match(node.fix, /18\.18/);
  assert.equal(codex.level, "fail");
  assert.match(codex.fix, /JAM_CODEX_BIN|install/i);
  assert.equal(r.ok, false);
});

test("doctor: unauthenticated codex and non-git project are WARN (not fail)", () => {
  const r = evaluateDoctor({ ...GOOD, codexAuthOk: false, inGitRepo: false, hasHead: false });
  assert.equal(r.checks.find((c) => c.id === "codex-auth").level, "warn");
  assert.equal(r.checks.find((c) => c.id === "git-repo").level, "warn");
  assert.equal(r.ok, true);                                  // warns don't break exit
});

test("doctor: node 18.18.0 exactly passes; 18.17.x fails", () => {
  assert.equal(evaluateDoctor({ ...GOOD, nodeVersion: "18.18.0" }).checks.find((c) => c.id === "node").level, "ok");
  assert.equal(evaluateDoctor({ ...GOOD, nodeVersion: "18.17.9" }).checks.find((c) => c.id === "node").level, "fail");
});

test("doctor: version mismatch is a warn", () => {
  const r = evaluateDoctor({ ...GOOD, pluginVersion: "0.19.0", packageVersion: "0.18.0" });
  assert.equal(r.checks.find((c) => c.id === "versions").level, "warn");
});
