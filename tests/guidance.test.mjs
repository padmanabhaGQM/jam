import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createRun, recordApproval } from "../plugins/jam/scripts/lib/actions.mjs";
import { recordVerification } from "../plugins/jam/scripts/lib/control.mjs";
import { validateDigest } from "../plugins/jam/scripts/lib/digest.mjs";
import { evaluateGate, producerHint } from "../plugins/jam/scripts/lib/gate.mjs";
import { decorateReason } from "../plugins/jam/scripts/gate-hook.mjs";
import { COMMAND_META } from "../plugins/jam/scripts/lib/help.mjs";
import { recordPlan } from "../plugins/jam/scripts/lib/plan.mjs";
import { runDir } from "../plugins/jam/scripts/lib/paths.mjs";
import { deriveNextAction } from "../plugins/jam/scripts/lib/resume.mjs";
import { getGate, readState, writeState } from "../plugins/jam/scripts/lib/state.mjs";
import { runJam as jam } from "./helpers/jam-main.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const JAM = path.join(ROOT, "plugins", "jam", "scripts", "jam.mjs");
const LIB = path.join(ROOT, "plugins", "jam", "scripts", "lib");

function tmpProject(prefix = "jam-guidance-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeActiveState(root, mutate, mode = "repair") {
  createRun({ projectRoot: root, runId: "r1", topic: "x", mode, now: "t0" });
  const dir = runDir(root, "r1");
  const state = readState(dir);
  mutate(state);
  writeState(dir, state);
  return { dir, state: readState(dir) };
}

test("1. evaluateGate pending verified gate names its producer", () => {
  const state = {
    mode: "repair",
    phase: "VERIFY",
    gates: { VERIFY: { mode: "human", status: "pending", approveFrom: "verified" } },
  };
  assert.match(evaluateGate(state, "VERIFY").reason, /produce it: jam verify --file <verdict\.json>/);
});

test("2. ready human gate uses CLI approve spelling only", () => {
  const state = {
    mode: "repair",
    phase: "DIAGNOSE",
    gates: { DIAGNOSE: { mode: "human", status: "rendered", approveFrom: "rendered" } },
  };
  const reason = evaluateGate(state, "DIAGNOSE").reason;
  assert.match(reason, /approve: jam approve DIAGNOSE/);
  assert.doesNotMatch(reason, /\/jam:/);
});

test("2b. gate-hook decorates approve spelling for Claude Code", () => {
  const reason = decorateReason("jam gate not satisfied — gate DIAGNOSE: ready for approval — approve: jam approve DIAGNOSE");
  assert.match(reason, /\(in Claude Code: \/jam:approve DIAGNOSE\)/);
});

test("3. recordApproval premature approval appends producer hint", () => {
  const root = tmpProject();
  const { dir } = writeActiveState(root, (state) => {
    state.phase = "VERIFY";
    state.gates = { VERIFY: { mode: "human", status: "pending", approveFrom: "verified" } };
  });
  assert.throws(
    () => recordApproval({ runDir: dir, gateId: "VERIFY" }),
    /produce it first: jam verify --file <verdict\.json>/
  );
});

test("3b. recordApproval refuses ratify gates with CLI spelling only", () => {
  const root = tmpProject();
  const { dir } = writeActiveState(root, (state) => {
    state.gates["action-drop-prod"] = { mode: "human", status: "pending", approveFrom: "ratified" };
  });
  assert.throws(
    () => recordApproval({ runDir: dir, gateId: "action-drop-prod" }),
    (err) => {
      assert.match(err.message, /jam ratify/);
      assert.doesNotMatch(err.message, /\/jam:/);
      return true;
    }
  );
});

test("4. getGate unknown-gate error lists known gates", () => {
  const state = { gates: { DIAGNOSE: { mode: "human", status: "pending", approveFrom: "rendered" } } };
  assert.throws(() => getGate(state, "nope"), /unknown gate: nope \(known gates: DIAGNOSE\)/);
});

test("5. jam advance at IMPLEMENT with pending sprint names start command", async () => {
  const root = tmpProject();
  writeActiveState(root, (state) => {
    state.phase = "IMPLEMENT";
    state.plan = { verifyCmd: "true", sprints: [{ id: "s1", title: "one", status: "pending", provenance: "planned", needs: [] }] };
    state.gates = {};
  });
  const r = await jam(root, ["advance"]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /jam sprint s1 --start/);
});

test("6. deriveNextAction starts the next available sprint before idle", () => {
  const state = {
    mode: "repair",
    phase: "IMPLEMENT",
    gates: {},
    plan: { verifyCmd: "true", sprints: [{ id: "s1", title: "one", status: "pending", provenance: "planned", needs: [] }] },
  };
  assert.deepEqual(deriveNextAction(state), { kind: "start", message: "start the next sprint: jam sprint s1 --start" });
});

test("7. digest validation errors teach the expected shape and avoid stale coverage wording", () => {
  const { errors } = validateDigest({});
  const staleCoveragePhrase = ["coverage", "delta"].join(" ");
  assert.ok(errors.some((e) => e.includes('globalMap — expected { "mermaid"')));
  assert.ok(errors.some((e) => e.includes('coverage — expected { "addressed"')));
  assert.ok(errors.every((e) => !e.includes(staleCoveragePhrase)));
});

test("7b. verdict and plan validation errors include expected-shape fragments", () => {
  const root = tmpProject();
  const { dir } = writeActiveState(root, (state) => {
    state.phase = "VERIFY";
    state.gates = { VERIFY: { mode: "human", status: "pending", approveFrom: "verified" } };
  });
  assert.throws(
    () => recordVerification({ runDir: dir, gateId: "VERIFY", verdict: {} }),
    /\{ "unresolvedBlockers": <number>/
  );

  writeActiveState(root, (state) => {
    state.phase = "PLAN";
    state.gates = { PLAN: { mode: "human", status: "pending", approveFrom: "planned" } };
  });
  assert.throws(
    () => recordPlan({ runDir: dir, plan: { verifyCmd: "true", sprints: [{ id: "s1" }] } }),
    /expected \{ "id": "s1", "title":/
  );
});

test("8. absolute CLI spelling guard: no /jam: in lib/*.mjs or jam.mjs", () => {
  const files = fs.readdirSync(LIB).filter((name) => name.endsWith(".mjs")).map((name) => path.join(LIB, name));
  files.push(JAM);
  const offenders = files.filter((file) => fs.readFileSync(file, "utf8").includes("/jam:"));
  assert.deepEqual(offenders.map((file) => path.relative(ROOT, file)), []);
});

test("9. sprint --verify failure prints tail, evidence path, and blocked consequence", async () => {
  const root = tmpProject();
  writeActiveState(root, (state) => {
    state.phase = "IMPLEMENT";
    state.plan = {
      verifyCmd: "for i in $(seq 1 25); do echo tail-$i; done; exit 7",
      sprints: [{ id: "s1", title: "one", status: "in-progress", provenance: "planned", needs: [] }],
    };
    state.gates = { "sprint-s1": { mode: "auto", status: "pending", approveFrom: "rendered" } };
  });
  const r = await jam(root, ["sprint", "s1", "--verify"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /exit 7/);
  assert.match(r.stdout, /tail-25/);
  assert.match(r.stdout, /evidence\/s1\.json/);
  assert.match(r.stdout, /--done stays blocked until verifyCmd passes/);
});

test("10. diagnose success announces state dir and roles", async () => {
  const root = tmpProject();
  const goal = path.join(root, "goal.md");
  fs.writeFileSync(goal, "done means tests pass\n");
  const r = await jam(root, ["diagnose", "fix it", "--goal", goal]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /state lives in docs\/superpowers\/loop-runs\//);
  assert.match(r.stdout, /you approve at gates/);
});

test("11. producerHint command forms prefix-match COMMAND_META usages", () => {
  const state = { plan: { sprints: [{ id: "s1" }] } };
  const cases = [
    ["DIAGNOSE", "rendered"],
    ["VERIFY", "verified"],
    ["PLAN", "planned"],
    ["BUILD-plan", "planned"],
    ["action-x", "ratified"],
    ["GROUND-scope", "scoped"],
    ["GROUND", "grounded"],
    ["CONVERGE-shortlist", "shortlisted"],
    ["CONVERGE-tiebreak", "contested"],
    ["CONVERGE", "decided"],
    ["SPECIFY-coverage", "covered"],
    ["SPECIFY", "specified"],
    ["sprint-s1", "evidence-passed"],
    ["custom-auto", "evidence-passed"],
  ];
  const tokenMatches = (usage, hint) => {
    const usageTokens = usage.split(/\s+/);
    const hintTokens = hint.split(/\s+/);
    if (hintTokens.length > usageTokens.length) return false;
    return hintTokens.every((token, i) => {
      const usageToken = usageTokens[i];
      return usageToken?.startsWith("<") || usageToken === token || usageToken?.split("|").includes(token);
    });
  };
  for (const [gateId, need] of cases) {
    const hint = producerHint(gateId, need, state);
    assert.ok(hint, `${need} has no hint`);
    const commandName = hint.split(/\s+/)[1];
    const forms = [COMMAND_META[commandName]?.usage, ...(COMMAND_META[commandName]?.usages ?? [])].filter(Boolean);
    assert.ok(forms.some((usage) => tokenMatches(usage, hint)), `${hint} does not prefix-match ${forms.join(" | ")}`);
  }
});

test("12. show-and-proceed pending gate includes producer hint", () => {
  const state = {
    mode: "repair",
    phase: "DIAGNOSE",
    gates: { DIAGNOSE: { mode: "show-and-proceed", status: "pending", approveFrom: "rendered" } },
  };
  assert.match(evaluateGate(state, "DIAGNOSE").reason, /produce it: jam render-digest DIAGNOSE --file <digest\.json>/);
});

test("13. producerHint picks sprint verify for plan sprints and generic evidence otherwise", () => {
  const state = { plan: { sprints: [{ id: "s1" }] } };
  assert.equal(producerHint("sprint-s1", "evidence-passed", state), "jam sprint s1 --verify");
  assert.equal(producerHint("sprint-unknown", "evidence-passed", state), 'jam evidence sprint-unknown --sprint <id> --cmd "<command>"');
  assert.equal(producerHint("custom-auto", "evidence-passed", state), 'jam evidence custom-auto --sprint <id> --cmd "<command>"');
});

test("14. producerHint covers every approveFrom value assigned in lib/*.mjs", () => {
  const values = new Set();
  for (const name of fs.readdirSync(LIB).filter((file) => file.endsWith(".mjs"))) {
    const text = fs.readFileSync(path.join(LIB, name), "utf8");
    for (const m of text.matchAll(/approveFrom\s*(?:[:=]|,)\s*["']([^"']+)["']/g)) values.add(m[1]);
    for (const m of text.matchAll(/addGate\([^)]*["'](rendered|verified|planned|ratified|scoped|grounded|shortlisted|contested|decided|covered|specified)["']/g)) values.add(m[1]);
    for (const m of text.matchAll(/humanGate\(["']([^"']+)["']\)/g)) values.add(m[1]);
  }
  for (const need of values) {
    assert.ok(producerHint("any-gate", need, { plan: { sprints: [{ id: "s1" }] } }), `missing producer hint for ${need}`);
  }
});

test("15. rejected gate guidance names the producer command (SLICE-1 fix)", () => {
  const state = {
    mode: "repair",
    phase: "VERIFY",
    gates: { VERIFY: { mode: "human", status: "rejected", approveFrom: "verified", rejectedReason: "weak verdict" } },
  };
  const reason = evaluateGate(state, "VERIFY").reason;
  assert.match(reason, /rejected: weak verdict/);
  assert.match(reason, /jam verify --file <verdict\.json>/);
  const next = deriveNextAction(state);
  assert.equal(next.kind, "rejected");
  assert.match(next.message, /jam verify --file <verdict\.json>/);
});

test("16. reject of an earlier-phase gate also names the producer command (SLICE-2 fix)", async () => {
  const root = tmpProject();
  const goal = path.join(root, "goal.md");
  fs.writeFileSync(goal, "done means tests pass\n");
  const digest = path.join(root, "digest.json");
  fs.writeFileSync(digest, JSON.stringify({
    summary: "s",
    traceToArchitecture: { componentsTouched: ["a"] },
    decisions: [],
    globalMap: { mermaid: "graph TD; A", isLocallyScopedRisk: true },
    coverage: { addressed: ["a"], dropped: [] },
  }));
  await jam(root, ["diagnose", "fix it", "--goal", goal]);
  await jam(root, ["render-digest", "DIAGNOSE", "--file", digest]);
  await jam(root, ["approve", "DIAGNOSE"]);
  const adv = await jam(root, ["advance"]);
  assert.equal(adv.status, 0, adv.stderr);          // now at VERIFY; DIAGNOSE is an earlier phase
  const r = await jam(root, ["reject", "DIAGNOSE", "--reason", "redo"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /earlier phase DIAGNOSE/);
  assert.match(r.stdout, /jam render-digest DIAGNOSE --file <digest\.json>/);
});
