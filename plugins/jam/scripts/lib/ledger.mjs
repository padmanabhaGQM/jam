/**
 * ledger.mjs — append-only audit trail (written by the plugin, not narrated by the model).
 *
 * Contract (when implemented):
 *   - append(runDir, entry): append a typed event to ledger.jsonl
 *     (approval | evidence | verdict | dismissal | steering | gate-change).
 *   - Every entry is timestamped and immutable; the ledger can reconstruct the
 *     full run independently of any model narration (design spec §5, §13).
 *
 * Not yet implemented (scaffold).
 */

export function notImplemented() {
  throw new Error("jam/ledger.mjs not yet implemented");
}
