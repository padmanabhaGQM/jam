import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

function libFiles(dir = path.join(ROOT, "plugins", "jam", "scripts", "lib")) {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...libFiles(p));
    else if (ent.isFile() && ent.name.endsWith(".mjs")) out.push(p);
  }
  return out;
}

function glossaryHas(text, term) {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^\\|\\s*${escaped}\\s*\\|`, "mi").test(text);
}

function markdownSection(text, heading) {
  const start = text.indexOf(heading);
  if (start === -1) return "";
  const rest = text.slice(start);
  const next = rest.slice(heading.length).search(/\n## /);
  return next === -1 ? rest : rest.slice(0, heading.length + next);
}

test("HOW-JAM-WORKS exists with both phase chains and a glossary covering core terms and statuses", () => {
  const text = read("HOW-JAM-WORKS.md");
  assert.match(text, /DIAGNOSE\s*→\s*VERIFY\s*→\s*PLAN\s*→\s*IMPLEMENT\s*→\s*FINISH/);
  assert.match(text, /GROUND\s*→\s*CONVERGE\s*→\s*SPECIFY\s*→\s*BUILD\s*→\s*FINISH/);
  assert.match(text, /BUILD -> per-sprint: isolated Codex turn -> reconcile -> verifyCmd -> auto gates ->\nFINISH/);
  assert.match(text, /^## Glossary$/m);

  const required = [
    "gate",
    "digest",
    "ledger",
    "verifyCmd",
    "sprint",
    "turn",
    "reconcile",
    "ratify",
    "dial",
    "rewind",
    "promotion",
    "audit",
    "stop-hook",
    "evidence-passed",
    "show-and-proceed",
    "open",
    "reconciled",
    "discarded",
    "unisolated",
  ];
  const stateText = read("plugins/jam/scripts/lib/state.mjs");
  const statuses = stateText
    .match(/const VALID_STATUSES = \[([^\]]+)\]/s)[1]
    .match(/"([^"]+)"/g)
    .map((s) => s.slice(1, -1));
  for (const term of [...required, ...statuses].sort()) {
    assert.ok(glossaryHas(text, term), `missing glossary row: ${term}`);
  }
  const terms = text
    .split("\n")
    .filter((line) => /^\|[^|-]/.test(line))
    .slice(1)
    .map((line) => line.split("|")[1].trim());
  assert.deepEqual(terms, [...terms].sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" })));
});

test("README and QUICKSTART link HOW-JAM-WORKS", () => {
  assert.match(read("README.md"), /\[HOW-JAM-WORKS\.md\]\(HOW-JAM-WORKS\.md\)/);
  assert.match(read("QUICKSTART.md"), /\[HOW-JAM-WORKS\.md\]\(HOW-JAM-WORKS\.md\)/);
});

test("QUICKSTART is CLI-first, shows render-digest before approval, and names jam-prompting provenance", () => {
  const text = read("QUICKSTART.md");
  assert.match(text, /jam-prompting/);
  assert.ok(text.indexOf("jam render-digest") >= 0, "missing jam render-digest");
  assert.ok(text.indexOf("jam approve DIAGNOSE") >= 0, "missing CLI approval");
  assert.ok(
    text.indexOf("jam render-digest") < text.indexOf("jam approve DIAGNOSE"),
    "jam render-digest must appear before the first DIAGNOSE approval",
  );
  assert.ok(text.includes("(in Claude Code: /jam:approve)"), "slash spelling should be noted once at first approval mention");
  assert.equal((text.match(/\/jam:approve/g) ?? []).length, 1, "slash approve spelling appears only once in QUICKSTART");
});

test("production-p1 example starts with an In plain English preamble", () => {
  const first15 = read("docs/examples/production-p1.md").split("\n").slice(0, 15).join("\n");
  assert.match(first15, /In plain English/);
});

test('docs and lib do not contain stale "coverage delta" wording', () => {
  const files = [
    "README.md",
    "QUICKSTART.md",
    "HOW-JAM-WORKS.md",
    ...libFiles().map((p) => path.relative(ROOT, p)),
  ];
  const offenders = files.filter((file) => read(file).includes("coverage delta"));
  assert.deepEqual(offenders, []);
});

test("README defines ledger fact in a sentence", () => {
  assert.match(read("README.md"), /A ledger fact is\b/);
});

test("README explains Stop-hook", () => {
  assert.match(read("README.md"), /Stop-hook/);
});

test("jam skills close D1-D10 drift notes", () => {
  const orchestrator = read("plugins/jam/skills/jam-orchestrator/SKILL.md");
  const greenfield = read("plugins/jam/skills/jam-greenfield/SKILL.md");

  assert.match(orchestrator, /\|\s*approveFrom\s*\|/);
  for (const status of ["rendered", "verified", "planned", "evidence-passed", "ratified"]) {
    assert.match(orchestrator, new RegExp(`\\|[^\\n]*${status}[^\\n]*\\|`), `missing gate-status table row: ${status}`);
  }

  assert.match(orchestrator, /turn token/);
  assert.match(orchestrator, /evidence-passed/);

  const rewind = markdownSection(orchestrator, "## Rewind");
  assert.match(rewind, /fresh sprint epoch/);

  const hardBlock = markdownSection(orchestrator, "### Hard-block tier");
  assert.match(hardBlock, /ratified/);

  const gateModes = markdownSection(orchestrator, "## Gate modes");
  assert.match(gateModes, /human/);
  assert.match(gateModes, /show-and-proceed/);
  assert.match(gateModes, /auto/);
  assert.match(gateModes, /jam dial/);

  assert.match(orchestrator, /greenfield sub-gates/);

  const turnStatuses = ["open", "reconciled", "discarded", "unisolated"];
  for (const status of turnStatuses) assert.match(greenfield, new RegExp(`\\b${status}\\b`));
  assert.match(greenfield, /HOW-JAM-WORKS\.md/);
});

test("package and plugin versions are 0.21.0", () => {
  const pkg = JSON.parse(read("package.json"));
  const plugin = JSON.parse(read("plugins/jam/.claude-plugin/plugin.json"));
  assert.equal(pkg.version, "0.21.0");
  assert.equal(plugin.version, "0.21.0");
  assert.equal(pkg.version, plugin.version);
});

test("CHANGELOG has a 0.21.0 entry", () => {
  assert.match(read("CHANGELOG.md"), /^## 0\.21\.0\b/m);
});
