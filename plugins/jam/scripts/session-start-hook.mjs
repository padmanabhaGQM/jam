#!/usr/bin/env node
/**
 * session-start-hook.mjs — announce availability and rehydrate.
 *
 * Contract (when implemented):
 *   - Announce that the Claude–Codex pairing (jam) is available.
 *   - If a run exists for the current project, load state.json and report where
 *     it stands (phase, open gate, active steering directives).
 *   - Surface missing preconditions (Codex not set up, project not git-trusted)
 *     instead of failing silently.
 *   - NEVER auto-start a run. Availability, not auto-launch (design spec §1, §9.5).
 *
 * FAIL-SAFE: until implemented, no-op.
 */

// TODO(jam): implement availability announce + rehydrate.
process.exit(0);
