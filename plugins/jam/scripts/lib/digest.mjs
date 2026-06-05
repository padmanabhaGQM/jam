/**
 * digest.mjs — intermediate-state digest validation & rendering.
 *
 * Contract (when implemented):
 *   - validate(digest): check against schemas/digest.schema.json; reject unless all
 *     four drift-detectors are present (trace-to-architecture, decision register,
 *     global map, spec/plan coverage).
 *   - render(digest): produce the glanceable terminal view (summary + Mermaid flow +
 *     guide). Optional browser Visual Companion for heavier visuals.
 *   - The gate hook refuses to advance unless a conforming digest exists (design spec §6).
 *
 * Not yet implemented (scaffold).
 */

export function notImplemented() {
  throw new Error("jam/digest.mjs not yet implemented");
}
