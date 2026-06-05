#!/usr/bin/env node
/**
 * gate-hook.mjs — Stop-hook gate enforcement (THE core control).
 *
 * Contract (when implemented):
 *   - Reads the active run's state.json (lib/state.mjs).
 *   - Determines the current gate and its mode (human | show-and-proceed | auto).
 *   - BLOCKS the Stop (exit non-zero with a reason on stdout/JSON) when the gate
 *     is unsatisfied: evidence not captured/re-run-passed, digest not rendered,
 *     or required human approval not recorded.
 *   - Allows the Stop only when the deterministic conditions hold.
 *   - The model cannot forge a pass: approval is a human-run /jam:approve that
 *     writes state; evidence is the plugin's own verification exit code.
 *
 * FAIL-SAFE: until implemented, this hook ALLOWS (never wedges a session).
 * See design spec §5, §2 (enforcement boundary).
 */

// TODO(jam): implement gate enforcement. Until then, allow.
process.exit(0);
