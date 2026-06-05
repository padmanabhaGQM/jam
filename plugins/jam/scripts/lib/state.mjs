/**
 * state.mjs — on-disk run state (the un-forgeable source of truth).
 *
 * Contract (when implemented):
 *   - resolveRunDir(cwd): locate docs/superpowers/loop-runs/<run-id>/ for the project.
 *   - readState(runDir) / writeState(runDir, state): load/persist state.json,
 *     validated against schemas/state.schema.json.
 *   - Helpers: currentGate(state), setGateStatus(...), recordApproval(...),
 *     addSteeringDirective(...), markCoverage(...).
 *   - All writes are atomic; the model never edits state.json directly — only
 *     these helpers (invoked by commands/hooks) do.
 *
 * Not yet implemented (scaffold).
 */

export function notImplemented() {
  throw new Error("jam/state.mjs not yet implemented");
}
