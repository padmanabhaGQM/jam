# Worked example: the production-p1 run

The production-p1 slice built jam's reject/rewind/dial commands; its PLAN went through **17 recorded adversarial verification rounds** before any code (the ledger proves the rounds and their blocker counts — reviewer identity is process provenance, not a ledger field; the review turns were driven through the Codex pipeline).

The blocker counts per VERIFY round were `6,4,4,1,1,3,5,1,3,1,1,1,1,2,2,2,0`. The slice then ran 6 sprints, each Codex-authored in an isolated worktree; 2 whole-slice review rounds with blockers `2,0`; and FINISH gated by the live acceptance run.

## The report

Captured verbatim from `node plugins/jam/scripts/jam.mjs report production-p1`:

```text
run production-p1 — repair — FINISH
  wall: 3h 59m   created: 2026-06-11T09:45:54.369Z
  phases: DIAGNOSE → VERIFY 1h 55m → PLAN 0s → IMPLEMENT 1h 31m → FINISH
  reviews: VERIFY 17 rounds (rounds to zero: 17); SLICE 2 rounds (rounds to zero: 2); 17 verification(s), last blockers=0
  sprints (6/6 done, 1h 15m total):
    p1-1  5m 08s  codex-bound ✓ transcript ✓  evidence exit 0  turn reconciled
    p1-2  5m 53s  codex-bound ✓ transcript ✓  evidence exit 0  turn reconciled
    p1-3  5m 57s  codex-bound ✓ transcript ✓  evidence exit 0  turn reconciled
    p1-4  35m 58s  codex-bound ✓ transcript ✓  evidence exit 0  turn reconciled
    p1-5  6m 58s  codex-bound ✓ transcript ✓  evidence exit 0  turn reconciled
    p1-6  15m 14s  codex-bound ✓ transcript ✓  evidence exit 0  turn reconciled
  turns: 6 opened, 6 reconciled, 0 discarded, 0 unisolated
  final-verification: ✓ npm test exit 0
  audit: PASS
```

## Three ledger facts

A recorded adversarial round — blockers counted, not remembered:

```json
{"at":"2026-06-11T11:41:50.073Z","type":"review-round","phase":"VERIFY","round":17,"blockers":0}
```

Codex's work landed only through this gated ingress:

```json
{"at":"2026-06-11T12:47:18.529Z","type":"turn-reconciled","sprintId":"p1-4","token":"p1-4#1","sessionId":"019eb69a-891d-7df0-9a09-0827be970252"}
```

The acceptance command re-ran live at FINISH:

```json
{"at":"2026-06-11T13:13:30.992Z","type":"final-verification","command":"npm test","exitCode":0}
```

## Read it yourself

The complete raw ledger for this run is checked in beside this file: [production-p1.ledger.jsonl](production-p1.ledger.jsonl) — every number above can be verified against it directly.


From this repository:

```bash
node plugins/jam/scripts/jam.mjs report production-p1
node plugins/jam/scripts/jam.mjs report production-p1 --json
```

This file was generated from the run directory in this repo: `docs/superpowers/loop-runs/production-p1`.
