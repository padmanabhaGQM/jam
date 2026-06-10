// Single source of jam's phase orders. ganjam runs in one of two modes.
export const repairPhaseOrder = ["DIAGNOSE", "VERIFY", "PLAN", "IMPLEMENT", "FINISH"];
export const greenfieldPhaseOrder = ["GROUND", "CONVERGE", "SPECIFY", "BUILD", "FINISH"];

// Greenfield phases that are defined but not yet implemented (ship in later ganjam slices).
export const GREENFIELD_STUB_PHASES = new Set(["BUILD"]);
export const GREENFIELD_STUB_SLICE = { BUILD: "G4" };

// repair is the default for any run without an explicit greenfield mode (incl. the legacy ALIGN flow).
export function phaseOrderFor(mode) {
  return mode === "greenfield" ? greenfieldPhaseOrder : repairPhaseOrder;
}
