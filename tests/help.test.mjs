import { test } from "node:test";
import assert from "node:assert/strict";
import { COMMAND_META, SHAPES, renderHelp, renderCommandHelp } from "../plugins/jam/scripts/lib/help.mjs";
import { validateDigest } from "../plugins/jam/scripts/lib/digest.mjs";
import { runJam as run } from "./helpers/jam-main.mjs";

const cwd = process.cwd();

test("renderHelp lists every registered command with its summary", () => {
  const out = renderHelp(COMMAND_META);
  for (const [name, meta] of Object.entries(COMMAND_META)) {
    assert.ok(out.includes(name), `help missing command: ${name}`);
    assert.ok(out.includes(meta.summary), `help missing summary for: ${name}`);
  }
  for (const g of ["Start:", "Drive:", "Supervise:", "Orient:"]) assert.ok(out.includes(g));
  assert.ok(out.includes("QUICKSTART.md") && out.includes("HOW-JAM-WORKS.md"));
});

test("bare jam, -h, --help, help all print help and exit 0", async () => {
  for (const args of [[], ["-h"], ["--help"], ["help"]]) {
    const r = await run(cwd, args);
    assert.equal(r.status, 0, `exit for ${JSON.stringify(args)}`);
    assert.ok(r.stdout.includes("Start:"), `no help for ${JSON.stringify(args)}`);
  }
});

test("unknown subcommand prints the error AND the help screen, exit 1", async () => {
  const r = await run(cwd, ["frobnicate"]);
  assert.equal(r.status, 1);
  assert.ok(r.stderr.includes("unknown subcommand: frobnicate"));
  assert.ok(r.stdout.includes("Start:"));
});

test("jam help render-digest shows the digest JSON shape and it VALIDATES", () => {
  const text = renderCommandHelp(COMMAND_META, "render-digest");
  assert.ok(text.includes("globalMap") && text.includes("isLocallyScopedRisk"));
  const parsed = JSON.parse(SHAPES.digest);
  assert.equal(validateDigest(parsed).valid, true, "SHAPES.digest must pass validateDigest");
});

test("jam help verify / plan show their shapes; unknown name falls back to full help", () => {
  assert.ok(renderCommandHelp(COMMAND_META, "verify").includes("unresolvedBlockers"));
  assert.ok(renderCommandHelp(COMMAND_META, "plan").includes("verifyCmd"));
  assert.equal(renderCommandHelp(COMMAND_META, "nope"), null);
});

test("planned commands include when-to-use guidance", () => {
  for (const name of ["diagnose", "start", "advance", "reconcile", "sprint", "approve", "reject", "rewind", "dial", "ratify", "promote-sprint", "codex-run"]) {
    assert.ok(COMMAND_META[name].when, `missing when guidance for ${name}`);
  }
});

test("doctor ok (exit 0, warnings allowed) suggests a first command", async () => {
  const r = await run(cwd, ["doctor"]);
  if (r.status === 0) assert.match(r.stdout, /next: jam init|next: jam diagnose/);
});
