// Single source of jam's phase orders. ganjam runs in one of two modes.
export const repairPhaseOrder = ["DIAGNOSE", "VERIFY", "PLAN", "IMPLEMENT", "FINISH"];
export const greenfieldPhaseOrder = ["GROUND", "CONVERGE", "SPECIFY", "BUILD", "FINISH"];

// Canonical gates that MUST exist + be approved to leave each greenfield phase.
// CONVERGE-tiebreak is intentionally NOT here — it is conditional (only when the two decisions disagree),
// and is enforced "if present" by the advance loop + convergence.mjs.
export const REQUIRED_GREENFIELD_GATES = {
  GROUND: ["GROUND-scope", "GROUND"],
  CONVERGE: ["CONVERGE-shortlist", "CONVERGE"],
  SPECIFY: ["SPECIFY-coverage", "SPECIFY"],
  BUILD: ["BUILD-plan"],
};

export const GREENFIELD_STUB_PHASES = new Set();

// repair is the default for any run without an explicit greenfield mode (incl. the legacy ALIGN flow).
export function phaseOrderFor(mode) {
  return mode === "greenfield" ? greenfieldPhaseOrder : repairPhaseOrder;
}
