/**
 * evidence.mjs — evidence, not claims.
 *
 * Contract (when implemented):
 *   - captureCodexEvidence(result): store Codex's reported commands/diffs/output verbatim.
 *   - rerunVerification(cmd, cwd): the PLUGIN runs the verification command itself
 *     and records the real exit code. A sprint's evidence gate requires exit 0 from
 *     THIS run — never Codex's claim (design spec §5).
 *   - Honest limit: proves tests ran & passed, not that they are meaningful (caveat C-2).
 *
 * Not yet implemented (scaffold).
 */

export function notImplemented() {
  throw new Error("jam/evidence.mjs not yet implemented");
}
