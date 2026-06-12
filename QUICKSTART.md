# jam Quickstart — your first supervised run

jam lets you supervise while the models work: Claude proposes and reviews, Codex implements, and the ledger proves what happened. You approve or reject every human gate; jam records those decisions, re-runs the project acceptance command, and leaves you with an auditable run report.

## 1. Install

Use Claude Code as the host. jam is a Claude Code plugin that composes the official Codex plugin.

Install the Codex CLI:

```bash
npm i -g @openai/codex
```

Authenticate Codex:

```bash
codex login
```

In Claude Code, install the official Codex plugin:

```text
/plugin marketplace add openai/codex-plugin-cc
```

```text
/plugin install codex@openai-codex
```

Set up the Codex plugin:

```text
/codex:setup
```

Install jam:

```text
/plugin marketplace add padmanabhaGQM/jam
```

```text
/plugin install jam@neel-plugins
```

Restart Claude Code after both plugins are installed.

Open the target repo in Claude Code and run the environment check:

```bash
jam doctor
```

Do not continue until every line is ✓ (⚠ on codex-auth is explained in the output).

## 2. Pick a target repo

Use a git repo with at least one commit.

```bash
git status --short
```

Codex edits a disposable copy; changes land only through a gated reconcile. Your branch and dirty files are out of reach during isolated Codex turns.

jam never pushes. It stops at FINISH with the acceptance command green and the ledger auditable.

Choose a small, real repair target with an acceptance command you trust:

```bash
npm test
```

Write the goal in a file inside the target repo:

```bash
printf '%s\n' 'Fix the failing behavior described here. Keep the change minimal. The acceptance command is npm test.' > jam-goal.md
```

Start a repair run:

```bash
jam diagnose "fix the issue in jam-goal.md" --goal jam-goal.md
```

## 3. The run — what YOU do at each gate

At every human gate, read the full artifact before approving. If the artifact is wrong, reject it with a reason; a rejection is a standing objection until the artifact is re-produced.

| Phase | What the model produces | What you read | Your verbs |
|---|---|---|---|
| `DIAGNOSE` | Root cause plus a 4-detector digest | The digest, cited evidence, active steering, and diagnosis scope | `/jam:approve DIAGNOSE` or `jam reject DIAGNOSE --reason "..."` |
| `VERIFY` | Adversarial review verdict | Surviving blockers, if any, and the evidence behind them | `/jam:approve VERIFY` or `jam reject VERIFY --reason "..."` |
| `PLAN` | Sprint DAG plus global `verifyCmd` | Sprint boundaries, dependencies, acceptance criteria, and whether `verifyCmd` is the whole bar | `/jam:approve PLAN` or `jam reject PLAN --reason "..."` |
| `IMPLEMENT` | Codex-authored sprint diffs and verification evidence | Sprint status, reconcile result, global verification output, and provenance | `/jam:approve IMPLEMENT` or `jam reject IMPLEMENT --reason "..."` |
| `FINISH` | Audit and report | Final verification, audit result, ledger facts, and any promoted scope | `/jam:approve FINISH` or `jam reject FINISH --reason "..."` |

Check where the run is:

```bash
jam status
```

Read the next action hint:

```bash
jam resume
```

Approve a good gate from Claude Code:

```text
/jam:approve DIAGNOSE
```

Or approve by CLI:

```bash
jam approve DIAGNOSE
```

Reject a bad gate:

```bash
jam reject DIAGNOSE --reason "The root cause does not explain the failing acceptance test."
```

When a gate is approved, advance:

```bash
jam advance
```

The sprint loop is the same every time:

1. Start the ready sprint.

```bash
jam sprint fix-1 --start
```

2. Let Codex work in an isolated turn.

```bash
jam codex-run --sprint fix-1 --prompt-file prompt.md --timeout 600000 --out-dir .jam/codex/fix-1
```

3. If the turn timed out but later completed, reconcile it.

```bash
jam reconcile --sprint fix-1
```

4. Re-run the global acceptance command through jam.

```bash
jam sprint fix-1 --verify
```

5. Mark the sprint done only after verification and Codex provenance are present.

```bash
jam sprint fix-1 --done
```

`jam advance` is the bar re-running LIVE at the phase boundary:

```bash
jam advance
```

At FINISH, render the ledger-backed report:

```bash
jam report
```

## 4. When things go sideways

You came back after a restart:

```bash
jam resume
```

You approved the wrong direction, not just a flawed artifact:

```bash
jam rewind PLAN --confirm PLAN
```

Approvals after the rewind target are invalidated by design. Re-produce the artifacts and approve them again.

A Codex turn timed out:

```bash
jam codex-status --event-log .jam/codex/fix-1/events.jsonl
```

That timeout is not a failure. jam never kills the process. When the turn completes, reconcile it:

```bash
jam reconcile --sprint fix-1
```

The environment changed or Codex auth looks wrong:

```bash
jam doctor
```

The implementation exposed necessary extra work:

```bash
jam promote-sprint fix-2 --title "Cover the missed edge case" --reason "The verified fix exposed an unplanned edge case."
```

The model proposes a consequential action:

```bash
jam propose-action action-1 --type delete --target path/to/file
```

Ratify only if you understand and accept it:

```bash
jam ratify action-1 --confirm action-1
```

Or deny it:

```bash
jam ratify action-1 --deny
```

You need the audit before FINISH:

```bash
jam audit
```

## 5. The proof

jam's README is honest that no run has been supervised live by a human at the gates. The run you just completed — with you approving and rejecting — is that proof. `jam report` shows it as ledger facts: your approvals, any rejections, every round. Keep it.
