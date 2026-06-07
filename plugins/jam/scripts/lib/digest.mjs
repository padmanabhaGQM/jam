export function validateDigest(digest) {
  const errors = [];
  if (!digest || typeof digest !== "object") {
    return { valid: false, errors: ["digest must be an object"] };
  }
  if (!digest.summary) errors.push("missing summary");

  const t = digest.traceToArchitecture;
  if (!t || !Array.isArray(t.componentsTouched)) {
    errors.push("missing traceToArchitecture.componentsTouched");
  }
  if (!Array.isArray(digest.decisions)) errors.push("missing decisions[]");

  const gm = digest.globalMap;
  if (!gm || typeof gm.mermaid !== "string" || typeof gm.isLocallyScopedRisk !== "boolean") {
    errors.push("missing/invalid globalMap");
  }

  const c = digest.coverage;
  if (!c || !Array.isArray(c.addressed) || !Array.isArray(c.dropped)) {
    errors.push("missing coverage delta");
  }

  return { valid: errors.length === 0, errors };
}
