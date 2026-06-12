export function renderStatus(state, runId) {
  const lines = [`run ${runId} — phase ${state.phase}`];
  if (state.mode === "greenfield") {
    const g = state.grounding ?? {};
    const byStatus = (g.claims ?? []).reduce((m, c) => ((m[c.status] = (m[c.status] ?? 0) + 1), m), {});
    lines.push(`mode greenfield · phase ${state.phase}`);
    lines.push(`  grounding: problem ${g.problem ? "set" : "unset"} · dimensions ${(g.dimensions ?? []).length} · claims: ${(g.claims ?? []).length}${Object.keys(byStatus).length ? " (" + Object.entries(byStatus).map(([k, v]) => `${k}:${v}`).join(", ") + ")" : ""} · converged ${g.converged ? "yes" : "no"}`);
    if (state.convergence) {
      const c = state.convergence;
      const byStatus = (c.ledger ?? []).reduce((m, r) => ((m[r.status] = (m[r.status] ?? 0) + 1), m), {});
      const agreeStr = c.agree === null ? "pending" : c.agree ? "agree" : "DISAGREE";
      lines.push(`  convergence: shortlist ${(c.shortlist ?? []).length} · decisions ${Object.keys(c.decisions ?? {}).length}/2 (${agreeStr}) · chosen ${c.chosen ?? "—"} · ledger ${(c.ledger ?? []).length}${Object.keys(byStatus).length ? " (" + Object.entries(byStatus).map(([k, v]) => `${k}:${v}`).join(", ") + ")" : ""} · decided ${c.decided ? "yes" : "no"}`);
    }
    if (state.spec) {
      const sp = state.spec;
      const red = sp.redProof ? `exit ${sp.redProof.exitCode}` : "none";
      const game = sp.gameability ? `${sp.gameability.survivingFindings} surviving` : "none";
      lines.push(`  spec: verifyCmd ${sp.verifyCmd ? "set" : "unset"} · checks ${(sp.checks ?? []).length} · red-proof ${red} · gameability ${game} · certified ${sp.certified ? "yes" : "no"}`);
    }
  }
  for (const [id, g] of Object.entries(state.gates)) {
    lines.push(`  gate ${id}: ${g.mode}/${g.status}`);
  }
  const active = state.steeringDirectives.filter((d) => d.status === "active");
  if (active.length) {
    lines.push(`  active directives: ${active.map((d) => d.id).join(", ")}`);
  }
  if (state.plan) {
    lines.push(`  verify: ${state.plan.verifyCmd}`);
    const done = new Set(state.plan.sprints.filter((s) => s.status === "done").map((s) => s.id));
    for (const sp of state.plan.sprints) {
      const needs = sp.needs ?? [];
      const blocked = sp.status === "pending" && needs.some((n) => !done.has(n));
      const tag = sp.status === "pending" ? (blocked ? " (blocked)" : " (ready)") : "";
      const needsStr = needs.length ? ` needs:${needs.join(",")}` : "";
      lines.push(`  sprint ${sp.id}: ${sp.status} [${sp.provenance ?? "?"}]${needsStr}${tag} — ${sp.title}`);
      for (const cs of sp.codexSessions ?? []) {
        lines.push(`      codex: ${cs.sessionId} (${cs.transcriptPath ? "transcript" : "no-transcript"})`);
      }
    }
    for (const p of state.promotions ?? []) {
      lines.push(`  promotion ${p.id}: ${p.reason} (by ${p.discoveredBy})`);
    }
  }
  for (const a of state.actions ?? []) {
    lines.push(`  action ${a.id}: ${a.type ?? "?"} [${a.irreversible ? "HARD-BLOCK" : "ok"}] ${a.status}${a.reasons?.length ? " — " + a.reasons.join("; ") : ""}`);
  }
  return lines.join("\n") + "\n";
}
