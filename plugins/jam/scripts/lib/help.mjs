export const SHAPES = {
  digest: `{
  "summary": "<one-paragraph diagnosis>",
  "traceToArchitecture": { "componentsTouched": ["src/file.mjs"] },
  "decisions": [{ "choice": "<what we decided>", "alternatives": ["<rejected>"], "why": "<reason>" }],
  "globalMap": { "mermaid": "graph TD; A-->B", "isLocallyScopedRisk": false },
  "coverage": { "addressed": ["<goal aspect covered>"], "dropped": ["<explicitly out of scope>"] }
}`,
  verdict: `{
  "unresolvedBlockers": 0,
  "findings": [{ "title": "<issue found>", "severity": "blocker", "resolution": "<how it was closed>" }]
}`,
  plan: `{
  "verifyCmd": "npm test",
  "sprints": [
    { "id": "s1", "title": "<unit of work>", "acceptanceCriteria": "<what done means>", "needs": [] }
  ]
}`,
};

export const COMMAND_META = {
  help: {
    group: "Start",
    summary: "Show the command list or command-specific help.",
    usage: "jam help [command]",
  },
  doctor: {
    group: "Start",
    summary: "Check whether this machine can run jam and Codex turns.",
    usage: "jam doctor",
  },
  init: {
    group: "Start",
    summary: "preflight + state/roles explainer + goal-file template",
    usage: "jam init",
  },
  diagnose: {
    group: "Start",
    summary: "Start a repair run from a topic and goal document.",
    usage: "jam diagnose <topic> --goal <file>  (or --goal-codex <goalId>)",
    when: "Use this for repair work when you have a written goal or Codex goal id. --goal-codex <goalId> reads the goal text from a Codex-stored goal; most users want --goal <file>.",
  },
  start: {
    group: "Start",
    summary: "Start a greenfield jam run from a topic.",
    usage: 'jam start "<topic>" --mode greenfield',
    when: "Use this for greenfield work; include --mode greenfield so the run can advance.",
  },
  "render-digest": {
    group: "Drive",
    summary: "Record a diagnosis digest for the current human gate.",
    usage: "jam render-digest <gateId> --file <digest.json>",
    shape: "digest",
  },
  verify: {
    group: "Drive",
    summary: "Record a verifier verdict for the current repair gate.",
    usage: "jam verify --file <verdict.json>",
    shape: "verdict",
  },
  plan: {
    group: "Drive",
    summary: "Record the repair implementation plan and sprint graph.",
    usage: "jam plan --file <plan.json>",
    shape: "plan",
  },
  "codex-run": {
    group: "Drive",
    summary: "Start a Codex turn, optionally isolated for a sprint.",
    usage: "jam codex-run --prompt-file <f> [--timeout <ms>] [--cwd <dir>] [--out-dir <dir>] [--sprint <id>] — the prompt file is written by the jam-prompting skill (Claude's instructions for this Codex turn)",
    when: "Use this when the orchestration prompt is ready and Codex should produce work.",
  },
  reconcile: {
    group: "Drive",
    summary: "Land a completed isolated sprint turn back into the working tree.",
    usage: "jam reconcile --sprint <id>",
    when: "Use this after an isolated Codex turn completes but did not auto-reconcile.",
  },
  "codex-resume": {
    group: "Drive",
    summary: "Resume an existing Codex session with a follow-up prompt.",
    usage: "jam codex-resume <sessionId> --prompt-file <f> [--timeout <ms>] [--out-dir <dir>]",
  },
  sprint: {
    group: "Drive",
    summary: "Start, verify, or finish one planned sprint.",
    usage: "jam sprint <id> --start|--verify|--done",
    when: "Use this to move an approved sprint through implementation, evidence, and completion.",
  },
  advance: {
    group: "Drive",
    summary: "Advance the active run to its next phase when gates allow it.",
    usage: "jam advance",
    when: "Use this after the current phase's required gates are approved or satisfied.",
  },
  "promote-sprint": {
    group: "Drive",
    summary: "Add a discovered sprint with provenance and dependencies.",
    usage: "jam promote-sprint <id> --title <t> --reason <r> [--acceptance <a>] [--discovered-by <d>]",
    when: "Use this when verification or review reveals required work outside the approved plan.",
  },
  evidence: {
    group: "Drive",
    summary: "Run and record command evidence for an auto gate.",
    usage: 'jam evidence <gateId> --sprint <id> --cmd "<command>"',
  },
  ground: {
    group: "Drive",
    summary: "Produce greenfield grounding artifacts and decisions.",
    usage: "jam ground <sharpen|claim|refute|converge>",
    usages: [
      "jam ground sharpen --file <scope.json>",
      "jam ground claim --file <json>",
      "jam ground refute --id <claimId>",
      "jam ground converge --file <grounding.json>",
    ],
  },
  converge: {
    group: "Drive",
    summary: "Shortlist, compare, and finalize greenfield solution direction.",
    usage: "jam converge <shortlist|decide|tiebreak|finalize>",
    usages: [
      "jam converge shortlist --file <shortlist.json>",
      "jam converge decide --agent <claude|codex> --file <json>",
      "jam converge tiebreak --choose <option>",
      "jam converge finalize --file <decision.json>",
    ],
  },
  specify: {
    group: "Drive",
    summary: "Lock greenfield coverage, red proof, gameability, and verify command.",
    usage: "jam specify <coverage|redproof|gameability|certify>",
    usages: [
      "jam specify coverage --file <coverage.json>",
      "jam specify redproof",
      "jam specify gameability --file <json>",
      "jam specify certify",
    ],
  },
  build: {
    group: "Drive",
    summary: "Record the greenfield build plan from the certified specification.",
    usage: "jam build plan --file <plan.json>",
    usages: [
      "jam build plan --file <plan.json>",
    ],
  },
  approve: {
    group: "Supervise",
    summary: "Approve a human gate after its required artifact exists.",
    usage: "jam approve <gateId>",
    when: "Use this only after Codex-produced evidence or digest output has satisfied the gate.",
  },
  reject: {
    group: "Supervise",
    summary: "Reject a human gate with a reason and require new production.",
    usage: 'jam reject <gateId> --reason "<text>"',
    when: "Use this when the artifact is not acceptable and should be re-produced.",
  },
  rewind: {
    group: "Supervise",
    summary: "Move the run back to an earlier phase and re-arm later gates.",
    usage: "jam rewind <phase> --confirm <phase>   (rewind invalidates approvals)",
    when: "Use this when earlier decisions need to be re-opened; it does not roll back git files.",
  },
  dial: {
    group: "Supervise",
    summary: "Tighten a gate to human, or loosen human to show-and-proceed (auto is never a dial target).",
    usage: "jam dial <gateId> --mode <human|show-and-proceed> [--confirm <gateId>]",
    when: "Use this when the gate policy itself needs an explicit operator adjustment.",
  },
  ratify: {
    group: "Supervise",
    summary: "Confirm or deny an irreversible proposed action.",
    usage: "jam ratify <id> --confirm <id> | --deny",
    when: "Use this for two-key confirmation of irreversible actions, not ordinary gate approval.",
  },
  steer: {
    group: "Supervise",
    summary: "Record a steering directive for future turns.",
    usage: "jam steer <redirection text>",
  },
  "add-gate": {
    group: "Supervise",
    summary: "Add a custom gate to the active run.",
    usage: "jam add-gate <gateId> --mode <human|auto|show-and-proceed>",
  },
  "propose-action": {
    group: "Supervise",
    summary: "Classify a proposed action as reversible or ratification-gated.",
    usage: "jam propose-action <id> --type <t> [--target <x>] [--command <c>]",
  },
  cancel: {
    group: "Supervise",
    summary: "Cancel the active jam run after confirming its run id.",
    usage: "jam cancel --confirm <runId>",
  },
  next: {
    group: "Orient",
    summary: "the single next action, copy-pasteable",
    usage: "jam next",
  },
  status: {
    group: "Orient",
    summary: "Show the active run state, gates, sprints, and directives.",
    usage: "jam status",
  },
  resume: {
    group: "Orient",
    summary: "Show status plus the next suggested action.",
    usage: "jam resume",
  },
  report: {
    group: "Orient",
    summary: "Render an active, named, or all-runs report.",
    usage: "jam report [runId] [--all] [--json|--md]",
  },
  audit: {
    group: "Orient",
    summary: "Audit the active run ledger for ordering and authorship rules.",
    usage: "jam audit",
  },
  "review-round": {
    group: "Orient",
    summary: "Append a bounded review-round ledger fact.",
    usage: "jam review-round --phase VERIFY|SLICE --round <n> --blockers <k> [--notes <text>]",
  },
  "codex-status": {
    group: "Orient",
    summary: "Inspect a Codex event log and matching transcript.",
    usage: "jam codex-status --event-log <events.jsonl>",
  },
};

export function renderHelp(meta) {
  const groups = ["Start", "Drive", "Supervise", "Orient"];
  const width = Math.max(...Object.keys(meta).map((n) => n.length)) + 2;
  let out = "jam - honest, controlled Claude-Codex build loop\n\n";
  out += "usage: jam <command> [args]        jam help <command> - details + JSON shapes\n";
  out += 'first run: jam init   then: jam diagnose "<topic>" --goal jam-goal.md\n\n';
  for (const group of groups) {
    out += `${group}:\n`;
    for (const [name, command] of Object.entries(meta)) {
      if (command.group === group) out += `  ${name.padEnd(width)}${command.summary}\n`;
    }
    out += "\n";
  }
  out += "docs: QUICKSTART.md - HOW-JAM-WORKS.md - README.md\n";
  return out;
}

export function renderCommandHelp(meta, name) {
  const command = meta[name];
  if (!command) return null;
  let out = `jam ${name} - ${command.summary}\n\nusage: ${command.usage}\n`;
  if (command.usages?.length) {
    out += "\nforms:\n";
    for (const usage of command.usages) out += `  ${usage}\n`;
  }
  if (command.when) out += `\n${command.when}\n`;
  if (command.shape) out += `\nexpected JSON (--file):\n${SHAPES[command.shape]}\n`;
  return out;
}
