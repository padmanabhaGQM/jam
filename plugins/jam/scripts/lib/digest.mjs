export function validateDigest(digest) {
  const errors = [];
  if (!digest || typeof digest !== "object") {
    return { valid: false, errors: ["digest must be an object"] };
  }
  if (!digest.summary) errors.push("missing summary");

  const t = digest.traceToArchitecture;
  if (!t || !Array.isArray(t.componentsTouched)) {
    errors.push('missing traceToArchitecture.componentsTouched — expected { "componentsTouched": ["<path>"] }');
  }
  if (!Array.isArray(digest.decisions)) errors.push("missing decisions[]");

  const gm = digest.globalMap;
  if (!gm || typeof gm.mermaid !== "string" || typeof gm.isLocallyScopedRisk !== "boolean") {
    errors.push('missing/invalid globalMap — expected { "mermaid": "<string>", "isLocallyScopedRisk": <true|false> }');
  }

  const c = digest.coverage;
  if (!c || !Array.isArray(c.addressed) || !Array.isArray(c.dropped)) {
    errors.push('missing/invalid coverage — expected { "addressed": ["..."], "dropped": ["..."] }');
  }

  return { valid: errors.length === 0, errors };
}

export function renderDigest(d) {
  if (!d || typeof d !== "object") return "(no digest)";
  const t = d.traceToArchitecture ?? {};
  const gm = d.globalMap ?? {};
  const cov = d.coverage ?? {};
  const lines = [];
  lines.push(`# jam digest — ${d.phase ?? ""}${d.sprint != null ? ` (sprint ${d.sprint})` : ""}`.trim());
  lines.push(d.summary ?? "");
  lines.push("## 1. Trace to architecture");
  for (const c of t.componentsTouched ?? []) lines.push(`- ${c}`);
  if (t.gapFromAgreed) lines.push(`- ⚠ gap from agreed: ${t.gapFromAgreed}`);
  lines.push("## 2. Decisions");
  for (const dec of d.decisions ?? []) lines.push(`- **${dec.choice}** (vs ${(dec.alternatives ?? []).join(", ")}) — ${dec.why}`);
  lines.push("## 3. Global map");
  lines.push("```mermaid\n" + (gm.mermaid ?? "") + "\n```");
  lines.push(`position: ${gm.currentPosition ?? ""}${gm.isLocallyScopedRisk ? "  ⚠ LOCAL-HACK RISK" : ""}`);
  lines.push("## 4. Coverage");
  lines.push(`addressed: ${(cov.addressed ?? []).join("; ")}`);
  lines.push(`dropped: ${(cov.dropped ?? []).join("; ")}`);
  return lines.join("\n");
}
