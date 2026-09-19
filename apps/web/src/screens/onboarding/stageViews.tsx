import { useEffect, useState, type ReactNode } from "react";
import { getOnboardingDiff, type OnboardingStatus } from "../../api.ts";
import { Pill } from "../../ui.tsx";
import {
  ACTION_HE, ARTIFACT_KIND_HE, Chips, Code, KV, LOADING_HE, Note, PHASE_HE, RISK_HE, RISK_TONE, Section, WRITER_HE, errText, fmtDate, fmtInt, fmtUsd, shortSha,
} from "./shared.tsx";
import type {
  BoundariesResult, ConfirmResult, DeliverResult, DiscoveryResult, ExistingConfigPolicy, GenerateResult, PlanResult, PlannedArtifact, ReviewResult, ScanResult, ValidateResult,
} from "./types.ts";

/**
 * What a stage shows AFTER it ran (its findings), and the form a human
 * gate shows WHILE it waits. One renderer per stage, all reading the
 * result shapes the core stages persist — so every number on screen is
 * something DCC recorded, never a UI-side guess.
 */

type GateProps<T> = { r: T; busy: boolean; onSubmit: (input: unknown) => Promise<void> };

const INVENTORY_TYPE_HE: Record<string, string> = {
  claude_md: "CLAUDE.md", nested_claude_md: "CLAUDE.md מקונן", rule: "Rule", skill: "Skill", agent: "Subagent", settings: "settings", hook: "Hook", mcp: "MCP",
  agents_md: "AGENTS.md", other_agent_rules: "הנחיות לכלי AI אחר", readme: "README", contributing: "CONTRIBUTING", security: "SECURITY", docs_dir: "תיקיית תיעוד",
  adr: "ADR", pr_template: "תבנית PR", codeowners: "CODEOWNERS", ci: "CI",
};
const TOOL_HE: Record<string, string> = { claude_code: "Claude Code", cross_tool: "חוצה כלים", other_agent: "כלי AI אחר", human: "לאנשים" };
const POLICY_HE: Record<ExistingConfigPolicy, string> = { keep: "לשמור כמו שהוא", merge: "למזג (להוסיף רק מה שחסר)", replace: "להחליף" };
const VERB_HE: Record<string, string> = { allow: "מותר", ask: "דורש אישור", deny: "חסום" };
const COVERAGE_TONE: Record<string, "ok" | "human" | "bad"> = { COVERED: "ok", PARTIAL: "human", MISSING: "bad" };
const COVERAGE_HE: Record<string, string> = { COVERED: "מכוסה", PARTIAL: "חלקי", MISSING: "חסר" };
const CONF_HE: Record<string, string> = { low: "ביטחון נמוך", medium: "ביטחון בינוני", high: "ביטחון גבוה" };
const COMPLEXITY_HE: Record<string, string> = { low: "נמוכה", medium: "בינונית", high: "גבוהה" };
const VERDICT_HE: Record<string, string> = { keep: "לשמור", merge: "למזג", outdated: "מיושן", conflicting: "סותר את הקוד" };
const FILE_STATUS_HE: Record<string, string> = { A: "נוסף", M: "שונה", D: "נמחק", R: "שם שונה", T: "סוג שונה" };

const Table = ({ head, children }: { head: string[]; children: ReactNode }) => (
  <div style={{ overflowX: "auto", border: "1px solid var(--border-soft)", borderRadius: 10 }}>
    <table className="wtable ob-files"><thead><tr>{head.map((h) => <th key={h}>{h}</th>)}</tr></thead><tbody>{children}</tbody></table>
  </div>
);
const Empty = ({ text }: { text: string }) => <p className="ob-sub">{text}</p>;

/* ── 1. scan ─────────────────────────────────────────────────────────── */

export function ScanView({ r, mode }: { r: ScanResult; mode: "initial" | "refresh" }) {
  const c = r.classification;
  const inv = r.inventory;
  const pf = r.preflight;
  return (
    <div>
      {!pf.claudeVersion
        ? <Note tone="crit">לא נמצא Claude Code על מכונת ה-DCC — קריאות ה-AI ייכשלו.</Note>
        : (
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
            <span className="ob-chip">Claude Code {pf.claudeVersion}</span>
            <span className={`ob-chip ${pf.restricted ? "ok" : "bad"}`}>{pf.restricted ? "✓" : "✗"} בידוד תצורת ה-repository (--restricted)</span>
            <span className={`ob-chip ${pf.permissionPrompts ? "ok" : "bad"}`}>{pf.permissionPrompts ? "✓" : "✗"} דחיית כתיבות ללא אישור</span>
            <span className={`ob-chip ${pf.jsonSchema ? "ok" : "human"}`}>{pf.jsonSchema ? "✓" : "~"} פלט מובנה (json-schema)</span>
            <span className={`ob-chip ${pf.maxBudget ? "ok" : "human"}`}>{pf.maxBudget ? "✓" : "~"} תקרת תקציב לקריאה</span>
            <span className={`ob-chip ${pf.sccUsed ? "ok" : "human"}`}>{pf.sccUsed ? "✓" : "~"} ספירת קוד (scc)</span>
          </div>
        )}
      <Section title="סביבת העבודה">
        <KV items={[
          { l: "סוג", v: r.workspaceKind === "worktree" ? "git worktree" : r.workspaceKind },
          { l: "commit בסיס", v: <Code>{shortSha(r.baselineSha)}</Code> },
          { l: "ענף onboarding", v: <Code>{r.branchName}</Code> },
          { l: "קבצים / תיקיות", v: `${fmtInt(r.profile.fileCount)} / ${fmtInt(r.profile.dirCount)}` },
          { l: "סימני בדיקות", v: fmtInt(r.profile.testSignalCount) },
          { l: "קבצי תיעוד", v: fmtInt(r.profile.docsCount) },
        ]} />
        {r.profile.maxDepthHit && <p className="ob-sub" style={{ marginTop: 6 }}>תיקיות עמוקות מ-6 רמות לא נסרקו.</p>}
      </Section>
      {mode === "refresh" && (
        <Section title={`מה השתנה מאז ה-onboarding הקודם (${r.changedSincePrevious?.length ?? 0} קבצים)`}>
          {r.previousBaselineSha && <p className="ob-sub" style={{ marginBottom: 6 }}>בסיס קודם <Code>{shortSha(r.previousBaselineSha)}</Code> → נוכחי <Code>{shortSha(r.baselineSha)}</Code></p>}
          {r.changedSincePrevious?.length
            ? <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>{r.changedSincePrevious.slice(0, 60).map((p) => <Code key={p}>{p}</Code>)}{r.changedSincePrevious.length > 60 && <span className="ob-sub">ועוד {r.changedSincePrevious.length - 60}</span>}</div>
            : <Empty text="לא נמצאו שינויים — הרענון יבדוק רק את עדכניות ה-artifacts הקיימים." />}
        </Section>
      )}
      <Section title="שפות ומערכות">
        {r.profile.languages.length > 0 ? (
          <Table head={["שפה", "קבצים", "שורות קוד", "מורכבות"]}>
            {r.profile.languages.map((l) => <tr key={l.name}><td>{l.name}</td><td>{fmtInt(l.fileCount)}</td><td>{l.code != null ? fmtInt(l.code) : "—"}</td><td>{l.complexity != null ? fmtInt(l.complexity) : "—"}</td></tr>)}
          </Table>
        ) : <Empty text="לא זוהו שפות." />}
        <div style={{ display: "grid", gap: 6, marginTop: 10, fontSize: 12 }}>
          <div><b>Build:</b> <Chips items={r.profile.buildSystems} /></div>
          <div><b>Frameworks:</b> <Chips items={r.profile.frameworks} /></div>
          <div><b>CI:</b> <Chips items={r.profile.ciProviders} /></div>
          <div><b>רמה עליונה:</b> <span style={{ display: "inline-flex", flexWrap: "wrap", gap: 4 }}>{r.profile.topLevel.map((p) => <Code key={p}>{p}</Code>)}</span></div>
        </div>
      </Section>
      <Section title="מה כבר קיים ב-Repository (לא מניחים שהוא ריק)">
        <KV items={[
          { l: "CLAUDE.md", v: inv.summary.hasClaudeMd ? `קיים (${inv.summary.claudeMdLines} שורות)` : "אין" },
          { l: "AGENTS.md", v: inv.summary.hasAgentsMd ? "קיים" : "אין" },
          { l: "rules / skills / agents", v: `${inv.summary.rules} / ${inv.summary.skills} / ${inv.summary.agents}` },
          { l: "hooks / MCP", v: `${inv.summary.hooks} / ${inv.summary.mcpServers}` },
          { l: "הנחיות לכלי AI אחרים", v: fmtInt(inv.summary.otherAgentRules) },
          { l: "README / docs / ADR", v: `${inv.summary.readme ? "✓" : "✗"} / ${inv.summary.docsDirs} / ${inv.summary.adrs}` },
          { l: "CONTRIBUTING / SECURITY / PR template", v: `${inv.summary.contributing ? "✓" : "✗"} / ${inv.summary.security ? "✓" : "✗"} / ${inv.summary.prTemplate ? "✓" : "✗"}` },
        ]} />
        {inv.items.length > 0 && (
          <details style={{ marginTop: 10 }}>
            <summary style={{ cursor: "pointer", fontSize: 12, fontWeight: 600 }}>{inv.items.length} פריטים שנמצאו</summary>
            <div style={{ marginTop: 8 }}>
              <Table head={["סוג", "נתיב", "שם", "שורות", "שייך ל"]}>
                {inv.items.map((it) => <tr key={`${it.type}:${it.path}`}><td>{INVENTORY_TYPE_HE[it.type] ?? it.type}</td><td className="path">{it.path}</td><td>{it.name}{it.paths?.length ? <span className="ob-sub"> · paths: {it.paths.join(", ")}</span> : null}</td><td>{it.lines ?? "—"}</td><td>{TOOL_HE[it.tool] ?? it.tool}</td></tr>)}
              </Table>
            </div>
          </details>
        )}
      </Section>
      <Section title="סיווג (קריאת AI קטנה, ללא קריאת קוד)">
        {!c ? <Note tone="warn">הסיווג האוטומטי נכשל{r.classificationError ? `: ${r.classificationError}` : ""} — ניתן לתקן ידנית בשלב הגבולות.</Note> : (
          <div style={{ display: "grid", gap: 10 }}>
            <KV items={[
              { l: "סוג המערכת", v: c.repository_type },
              { l: "צורת ארכיטקטורה", v: c.architecture_shape ?? "—" },
              { l: "מורכבות", v: COMPLEXITY_HE[c.complexity] ?? c.complexity },
              { l: "ביטחון", v: CONF_HE[c.confidence] ?? c.confidence },
              { l: "Legacy", v: c.legacy_indicator ? "כן" : "לא" },
              { l: "תיעוד / בדיקות", v: `${c.documentation_maturity ?? "—"} / ${c.testing_maturity ?? "—"}` },
            ]} />
            <div style={{ fontSize: 12 }}><b>Stack:</b> <Chips items={c.detected_technology_stack} /></div>
            <div style={{ fontSize: 12 }}><b>תחומים:</b> <Chips items={c.detected_domains} /></div>
            {c.summary_he && <Note tone="ai">{c.summary_he}</Note>}
            {(c.discovery_areas_required?.length || c.discovery_areas_not_required?.length) ? (
              <div style={{ display: "grid", gap: 4, fontSize: 12 }}>
                <div><b>Discovery יתמקד ב:</b> <Chips items={c.discovery_areas_required} tone="ok" /></div>
                <div><b>לא נדרש:</b> <Chips items={c.discovery_areas_not_required} /></div>
              </div>
            ) : null}
            {c.uncertainties?.length ? <div style={{ fontSize: 12 }}><b>אי-ודאויות שה-AI ציין:</b><ul className="ob-list">{c.uncertainties.map((u, i) => <li key={i}>{u}</li>)}</ul></div> : null}
          </div>
        )}
      </Section>
      <Section title="מה יוצע בשלב הגבולות">
        <p style={{ fontSize: 12.5 }}>
          פרופיל אבטחה מוצע: <b>{r.suggestions.profileId}</b> · {r.suggestions.denyRules.length} כללי חסימת קריאה (תיקיות רעש שנמצאו בפועל + סודות) · {r.suggestions.existingConfig.length} החלטות על תצורה קיימת.
        </p>
      </Section>
    </div>
  );
}

/* ── 2. boundaries ───────────────────────────────────────────────────── */

export function BoundariesGate({ r, busy, onSubmit }: GateProps<BoundariesResult>) {
  const prev = r.approved;
  const [profileId, setProfileId] = useState(prev?.profileId ?? r.suggestedProfileId);
  const [rules, setRules] = useState<{ pattern: string; reason: string }[]>(() => r.suggestedRules);
  const [newRule, setNewRule] = useState("");
  const [existing, setExisting] = useState<Record<string, ExistingConfigPolicy>>(() => Object.fromEntries(r.existing.map((e) => [e.path, prev?.existingConfig?.[e.path] ?? e.suggested])));
  const [override, setOverride] = useState(prev?.classificationOverride ?? "");
  const [notes, setNotes] = useState(prev?.notes ?? "");
  const c = r.classification;
  const addRule = () => {
    const p = newRule.trim();
    if (!p) return;
    const pattern = /^\w+\(.*\)$/.test(p) ? p : `Read(${p})`;
    if (!rules.some((x) => x.pattern === pattern)) setRules([...rules, { pattern, reason: "נוסף ידנית" }]);
    setNewRule("");
  };
  return (
    <div style={{ display: "grid", gap: 6 }}>
      {r.carriedOver && <Note tone="info">ההחלטות מההרצה הקודמת מולאו מראש — אשרו או שנו.</Note>}
      <Section title="הסיווג שה-AI הציע">
        {c ? (
          <div style={{ display: "grid", gap: 8 }}>
            <KV items={[{ l: "סוג המערכת", v: c.repository_type }, { l: "מורכבות", v: COMPLEXITY_HE[c.complexity] ?? c.complexity }, { l: "ביטחון", v: CONF_HE[c.confidence] ?? c.confidence }]} />
            <div style={{ fontSize: 12 }}><b>Stack:</b> <Chips items={c.detected_technology_stack} /> <b style={{ marginInlineStart: 8 }}>תחומים:</b> <Chips items={c.detected_domains} /></div>
            {c.summary_he && <p style={{ fontSize: 12.5, color: "var(--ink-700)" }}>{c.summary_he}</p>}
          </div>
        ) : <Note tone="warn">אין סיווג אוטומטי — תארו את המערכת בשורה-שתיים בשדה התיקון למטה.</Note>}
        <div className="field" style={{ marginTop: 8 }}>
          <label>תיקון לסיווג (אופציונלי — עובר ל-Discovery כידע אנושי)</label>
          <textarea rows={2} value={override} onChange={(e) => setOverride(e.target.value)} placeholder="למשל: זו לא מערכת demo אלא מערכת ייצור של לקוח פיננסי; ה-frontend נטוש" />
        </div>
      </Section>
      <Section title="פרופיל אבטחה (יחול על settings.json שייווצר)">
        <div style={{ display: "grid", gap: 6 }}>
          {r.profiles.map((p) => (
            <label key={p.id} style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12.5, cursor: "pointer" }}>
              <input type="radio" name="ob-profile" checked={profileId === p.id} onChange={() => setProfileId(p.id)} style={{ marginTop: 3 }} />
              <span><b>{p.label}</b>{p.id === r.suggestedProfileId && <span className="ob-chip" style={{ marginInlineStart: 6 }}>מוצע</span>}<br /><span className="ob-sub">{p.description}</span></span>
            </label>
          ))}
        </div>
      </Section>
      <Section title="מה אסור ל-AI לקרוא" aside={<span className="ob-sub">נאכף על כל קריאת AI מכאן והלאה, ונכנס ל-settings.json</span>}>
        <div style={{ display: "grid", gap: 4 }}>
          {rules.map((rule) => (
            <div key={rule.pattern} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
              <Code>{rule.pattern}</Code><span className="ob-sub" style={{ flex: 1 }}>{rule.reason}</span>
              <button type="button" className="ob-toggle" onClick={() => setRules(rules.filter((x) => x.pattern !== rule.pattern))}>הסר</button>
            </div>
          ))}
          {rules.length === 0 && <Empty text="אין כללי חסימה — ה-AI יוכל לקרוא כל קובץ ב-worktree." />}
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
          <input value={newRule} onChange={(e) => setNewRule(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addRule(); } }} placeholder="./legacy/** או Read(./**/*.bak)" style={{ direction: "ltr", fontFamily: "var(--mono)", fontSize: 11.5, flex: 1, padding: "6px 10px", border: "1px solid var(--border-hairline)", borderRadius: 8 }} />
          <button type="button" className="btn btn-secondary btn-sm" onClick={addRule}>הוסף כלל</button>
        </div>
      </Section>
      {r.existing.length > 0 && (
        <Section title="תצורת AI ותיעוד שכבר קיימים — מה לעשות איתם">
          <Table head={["קובץ", "סוג", "ההצעה ולמה", "החלטה"]}>
            {r.existing.map((e) => (
              <tr key={e.path}>
                <td className="path">{e.path}{e.lines ? <span className="ob-sub" style={{ direction: "rtl" }}> ({e.lines} שורות)</span> : null}</td>
                <td>{INVENTORY_TYPE_HE[e.type] ?? e.type}</td>
                <td style={{ fontSize: 11.5 }}>{e.why_he}</td>
                <td>
                  <select value={existing[e.path] ?? e.suggested} onChange={(ev) => setExisting({ ...existing, [e.path]: ev.target.value as ExistingConfigPolicy })} style={{ fontSize: 12 }}>
                    {(["keep", "merge", "replace"] as const).map((p) => <option key={p} value={p}>{POLICY_HE[p]}</option>)}
                  </select>
                </td>
              </tr>
            ))}
          </Table>
        </Section>
      )}
      <div className="field" style={{ marginTop: 12 }}>
        <label>הערות לצוות ה-AI (אופציונלי)</label>
        <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="דברים שכדאי ל-Discovery לדעת מראש: אזורים נטושים, מה עומד להשתנות, מי הבעלים" />
      </div>
      <div className="ob-actions" style={{ marginTop: 12 }}>
        <button className="btn btn-primary" disabled={busy} onClick={() => onSubmit({ rules: rules.map((x) => x.pattern), profileId, existingConfig: existing, classificationOverride: override.trim() || undefined, notes: notes.trim() || undefined })}>
          {busy ? "שומר…" : "✓ אשר גבולות והמשך"}
        </button>
        <span className="ob-sub">החלטה בלבד — לא נכתב קובץ. ניתן לחזור לכאן ולשנות.</span>
      </div>
    </div>
  );
}

export function BoundariesView({ r }: { r: BoundariesResult }) {
  const a = r.approved;
  if (!a) return <Empty text="עדיין לא אושר." />;
  const ep = r.effectivePolicy;
  const profileLabel = r.profiles.find((p) => p.id === a.profileId)?.label ?? a.profileId;
  return (
    <div>
      <KV items={[
        { l: "פרופיל אבטחה", v: profileLabel },
        { l: "כללי חסימת קריאה", v: fmtInt(a.rules.length) },
        { l: "אושר", v: fmtDate(r.approvedAt) },
      ]} />
      {ep && (
        <Section title="המדיניות האפקטיבית (פרופיל ארגוני + חסימות של ה-repository)">
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
            {([["קריאה", ep.profile.read], ["כתיבה", ep.profile.write], ["רשת", ep.profile.network], ["MCP", ep.profile.mcp], ...Object.entries(ep.profile.commands)] as [string, string][]).map(([k, v]) => (
              <span key={k} className={`ob-chip ${v === "allow" ? "ok" : v === "deny" ? "bad" : "human"}`}>{k}: {VERB_HE[v] ?? v}</span>
            ))}
          </div>
        </Section>
      )}
      <Section title="חסימות קריאה">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>{a.rules.map((x) => <Code key={x}>{x}</Code>)}{a.rules.length === 0 && <Empty text="ללא." />}</div>
      </Section>
      {Object.keys(a.existingConfig).length > 0 && (
        <Section title="תצורה קיימת">
          <ul className="ob-list">{Object.entries(a.existingConfig).map(([p, pol]) => <li key={p}><Code>{p}</Code> — {POLICY_HE[pol]}</li>)}</ul>
        </Section>
      )}
      {a.classificationOverride && <Section title="תיקון לסיווג"><p style={{ fontSize: 12.5 }}>{a.classificationOverride}</p></Section>}
      {a.notes && <Section title="הערות"><p style={{ fontSize: 12.5 }}>{a.notes}</p></Section>}
    </div>
  );
}

/* ── 3. discovery ────────────────────────────────────────────────────── */

export function DiscoveryView({ r }: { r: DiscoveryResult }) {
  const d = r.discovery;
  const calls = Object.entries(r.stats.toolCalls ?? {});
  const totalCalls = calls.reduce((s, [, n]) => s + n, 0);
  return (
    <div>
      <KV items={[
        { l: "קריאות כלים", v: `${totalCalls}${calls.length ? ` (${calls.map(([k, n]) => `${k} ${n}`).join(", ")})` : ""}` },
        { l: "עלות", v: fmtUsd(r.stats.costUsd) },
        { l: "סבבים", v: r.stats.numTurns ?? "—" },
        { l: "ראיות (קבצים שנבדקו)", v: fmtInt(d.evidence_paths?.length ?? 0) },
      ]} />
      {d.purpose && <Section title="מטרת המערכת"><p style={{ fontSize: 13, lineHeight: 1.6 }}>{d.purpose}</p></Section>}
      <Section title="כיסוי התיעוד הקיים (מה לא צריך להיכתב שוב)">
        {d.coverage?.length ? (
          <Table head={["תחום", "מצב", "מקורות", "הערה"]}>
            {d.coverage.map((c, i) => <tr key={i}><td>{c.area}</td><td><span className={`ob-chip ${COVERAGE_TONE[c.status] ?? ""}`}>{COVERAGE_HE[c.status] ?? c.status}</span></td><td>{c.sources?.length ? <span style={{ display: "inline-flex", flexWrap: "wrap", gap: 3 }}>{c.sources.map((s) => <Code key={s}>{s}</Code>)}</span> : "—"}</td><td style={{ fontSize: 11.5 }}>{c.note ?? ""}</td></tr>)}
          </Table>
        ) : <Empty text="לא דווח כיסוי." />}
      </Section>
      <Section title={`רכיבים (${d.components?.length ?? 0})`}>
        {d.components?.length ? (
          <div style={{ display: "grid", gap: 8 }}>
            {d.components.map((c, i) => (
              <div key={i} className="ob-q">
                <b style={{ fontSize: 12.5 }}>{c.name}</b>{c.purpose && <span style={{ fontSize: 12.5 }}> — {c.purpose}</span>}
                <div style={{ marginTop: 4, display: "flex", flexWrap: "wrap", gap: 3 }}>{c.paths.map((p) => <Code key={p}>{p}</Code>)}</div>
                {c.evidence?.length ? <div className="ob-sub" style={{ marginTop: 3 }}>ראיה: {c.evidence.join(" · ")}</div> : null}
              </div>
            ))}
          </div>
        ) : <Empty text="לא זוהו רכיבים." />}
      </Section>
      {d.entry_points?.length ? (
        <Section title="נקודות כניסה">
          <Table head={["שם", "נתיב", "איך מריצים"]}>{d.entry_points.map((e, i) => <tr key={i}><td>{e.name ?? "—"}</td><td className="path">{e.path}</td><td style={{ fontSize: 11.5 }}>{e.how_to_run ? <Code>{e.how_to_run}</Code> : "—"}</td></tr>)}</Table>
        </Section>
      ) : null}
      {d.build_test?.length ? (
        <Section title="פקודות build / test (לא הורצו על ידי DCC — מסומנות לפי רמת ביטחון)">
          <Table head={["שם", "פקודה", "תיקייה", "ביטחון", "ראיה"]}>
            {d.build_test.map((b, i) => <tr key={i}><td>{b.name}</td><td><Code>{b.command}</Code></td><td className="path">{b.cwd ?? "."}</td><td><span className={`ob-chip ${b.confidence === "high" ? "ok" : b.confidence === "low" ? "bad" : "human"}`}>{CONF_HE[b.confidence] ?? b.confidence}</span></td><td style={{ fontSize: 11.5 }}>{b.evidence ?? "—"}</td></tr>)}
          </Table>
        </Section>
      ) : null}
      {d.key_flows?.length ? (
        <Section title="Flows מרכזיים">
          <div style={{ display: "grid", gap: 8 }}>
            {d.key_flows.map((f, i) => (
              <div key={i} className="ob-q">
                <b style={{ fontSize: 12.5 }}>{f.name}</b>
                {f.steps?.length ? <ol className="ob-list" style={{ marginTop: 4 }}>{f.steps.map((s, j) => <li key={j}>{s}</li>)}</ol> : null}
                {f.paths?.length ? <div style={{ marginTop: 4, display: "flex", flexWrap: "wrap", gap: 3 }}>{f.paths.map((p) => <Code key={p}>{p}</Code>)}</div> : null}
              </div>
            ))}
          </div>
        </Section>
      ) : null}
      {d.integrations?.length ? (
        <Section title="אינטגרציות">
          <Table head={["מערכת", "כיוון", "נתיבים", "אילוצים"]}>
            {d.integrations.map((x, i) => <tr key={i}><td>{x.system}</td><td>{x.direction ?? "—"}</td><td>{x.paths?.length ? <span style={{ display: "inline-flex", flexWrap: "wrap", gap: 3 }}>{x.paths.map((p) => <Code key={p}>{p}</Code>)}</span> : "—"}</td><td style={{ fontSize: 11.5 }}>{x.constraints?.join(" · ") ?? "—"}</td></tr>)}
          </Table>
        </Section>
      ) : null}
      {d.boundaries?.length ? <Section title="גבולות בין חלקי המערכת"><ul className="ob-list">{d.boundaries.map((b, i) => <li key={i}>{b.description}{b.paths?.length ? <> — {b.paths.map((p) => <Code key={p}>{p}</Code>)}</> : null}</li>)}</ul></Section> : null}
      {d.generated_or_protected_areas?.length ? (
        <Section title="אזורים מיוצרים / מוגנים (יקבלו guardrail)">
          <Table head={["נתיב", "למה", "סוג"]}>{d.generated_or_protected_areas.map((a, i) => <tr key={i}><td className="path">{a.path}</td><td style={{ fontSize: 11.5 }}>{a.reason}</td><td>{a.kind ?? "—"}</td></tr>)}</Table>
        </Section>
      ) : null}
      {d.constraints?.length ? <Section title="אילוצים"><ul className="ob-list">{d.constraints.map((c, i) => <li key={i}>{c.severity && <span className={`ob-chip ${/high|critical/i.test(c.severity) ? "bad" : "human"}`} style={{ marginInlineEnd: 6 }}>{c.severity}</span>}{c.statement}{c.evidence && <span className="ob-sub"> — {c.evidence}</span>}</li>)}</ul></Section> : null}
      {d.where_to_look?.length ? (
        <Section title="איפה לחפש לפי סוג משימה">
          <Table head={["סוג משימה", "נתיבים", "הערה"]}>{d.where_to_look.map((w, i) => <tr key={i}><td>{w.task_type}</td><td><span style={{ display: "inline-flex", flexWrap: "wrap", gap: 3 }}>{w.paths.map((p) => <Code key={p}>{p}</Code>)}</span></td><td style={{ fontSize: 11.5 }}>{w.note ?? ""}</td></tr>)}</Table>
        </Section>
      ) : null}
      {d.existing_instructions_assessment?.length ? (
        <Section title="הערכת הנחיות AI קיימות">
          <Table head={["קובץ", "מסקנה", "למה"]}>{d.existing_instructions_assessment.map((a, i) => <tr key={i}><td className="path">{a.path}</td><td><span className={`ob-chip ${a.verdict === "keep" ? "ok" : a.verdict === "conflicting" ? "bad" : "human"}`}>{VERDICT_HE[a.verdict] ?? a.verdict}</span></td><td style={{ fontSize: 11.5 }}>{a.reason ?? ""}</td></tr>)}</Table>
        </Section>
      ) : null}
      <Section title={`UNKNOWN — מה לא ניתן היה לקבוע מהקוד (${d.unknowns?.length ?? 0})`}>
        {d.unknowns?.length ? <Note tone="warn"><ul className="ob-list">{d.unknowns.map((u, i) => <li key={i}>{u}</li>)}</ul></Note> : <Empty text="ללא." />}
      </Section>
      <Section title={`שאלות לאדם (${d.questions?.length ?? 0}) — יוצגו בשלב האימות`}>
        {d.questions?.length ? <ul className="ob-list">{d.questions.map((q) => <li key={q.id}>{q.question_he} <Pill tone={RISK_TONE[q.risk_if_unknown] ?? "inactive"}>{RISK_HE[q.risk_if_unknown] ?? q.risk_if_unknown}</Pill></li>)}</ul> : <Empty text="אין שאלות — שלב האימות ידולג." />}
      </Section>
      {d.evidence_paths?.length ? (
        <details style={{ marginTop: 12 }}>
          <summary style={{ cursor: "pointer", fontSize: 12, fontWeight: 600 }}>{d.evidence_paths.length} קבצים שנבדקו כראיה</summary>
          <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 3 }}>{d.evidence_paths.map((p) => <Code key={p}>{p}</Code>)}</div>
        </details>
      ) : null}
    </div>
  );
}

/* ── 4. confirm ──────────────────────────────────────────────────────── */

function Digest({ r }: { r: ConfirmResult }) {
  const covered = r.digest.coverage.filter((c) => c.status === "COVERED").length;
  return (
    <KV items={[
      { l: "רכיבים", v: r.digest.components }, { l: "אינטגרציות", v: r.digest.integrations }, { l: "אילוצים", v: r.digest.constraints },
      { l: "תיעוד קיים מכוסה", v: `${covered}/${r.digest.coverage.length}` }, { l: "UNKNOWN", v: r.digest.unknowns.length },
    ]} />
  );
}

export function ConfirmGate({ r, busy, onSubmit }: GateProps<ConfirmResult>) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [corrections, setCorrections] = useState("");
  const answered = r.questions.filter((q) => (answers[q.id] ?? "").trim()).length;
  return (
    <div>
      <Digest r={r} />
      {r.digest.purpose && <p style={{ fontSize: 12.5, marginTop: 10, color: "var(--ink-700)" }}><b>מה ה-Discovery הבין:</b> {r.digest.purpose}</p>}
      <Section title={`${r.questions.length} שאלות שרק אתם יכולים לענות עליהן`} aside={<span className="ob-sub">מה שלא נענה נשמר כ-UNKNOWN — לא מומצא</span>}>
        <div style={{ display: "grid", gap: 10 }}>
          {r.questions.map((q, i) => (
            <div key={q.id} className="ob-q">
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <b style={{ fontSize: 13 }}>{i + 1}. {q.question_he}</b>
                <Pill tone={RISK_TONE[q.risk_if_unknown] ?? "inactive"}>{RISK_HE[q.risk_if_unknown] ?? q.risk_if_unknown}</Pill>
                {q.related_area && <span className="ob-chip">{q.related_area}</span>}
              </div>
              <p className="ob-sub" style={{ marginTop: 3 }}>למה זה חשוב: {q.why_it_matters_he}</p>
              <textarea rows={2} value={answers[q.id] ?? ""} onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })} placeholder="תשובה — או השאירו ריק אם אינכם יודעים" style={{ width: "100%", marginTop: 6, fontSize: 12.5, padding: "7px 10px", border: "1px solid var(--border-hairline)", borderRadius: 8, fontFamily: "inherit" }} />
            </div>
          ))}
        </div>
      </Section>
      <div className="field" style={{ marginTop: 12 }}>
        <label>תיקונים לממצאי ה-Discovery (אופציונלי)</label>
        <textarea rows={3} value={corrections} onChange={(e) => setCorrections(e.target.value)} placeholder="למשל: רכיב X כבר לא בשימוש; הפקודה הנכונה לבדיקות היא …; האינטגרציה עם Y היא חד-כיוונית" />
      </div>
      <div className="ob-actions" style={{ marginTop: 12 }}>
        <button className="btn btn-primary" disabled={busy} onClick={() => onSubmit({ answers: r.questions.map((q) => ({ id: q.id, answer_he: answers[q.id] ?? "" })), corrections })}>
          {busy ? "שומר…" : `✓ שמור ${answered}/${r.questions.length} תשובות והמשך`}
        </button>
        {answered < r.questions.length && <span className="ob-sub">{r.questions.length - answered} שאלות יירשמו כ-UNKNOWN.</span>}
      </div>
    </div>
  );
}

export function ConfirmView({ r, status }: { r: ConfirmResult; status: OnboardingStatus }) {
  return (
    <div>
      <Digest r={r} />
      {status === "Skipped" || r.questions.length === 0
        ? <Note tone="info">ה-Discovery לא השאיר שאלות פתוחות — השלב דולג אוטומטית.</Note>
        : (
          <Section title="תשובות (ידע אנושי, לא מסקנת AI)">
            <div style={{ display: "grid", gap: 8 }}>
              {r.questions.map((q) => {
                const a = r.answers?.find((x) => x.id === q.id);
                return (
                  <div key={q.id} className="ob-q">
                    <b style={{ fontSize: 12.5 }}>{q.question_he}</b>
                    <p style={{ fontSize: 12.5, marginTop: 3 }}>{a?.status === "answered" ? a.answer_he : <span style={{ color: "var(--status-warning)", fontWeight: 600 }}>UNKNOWN — לא נענה</span>}</p>
                  </div>
                );
              })}
            </div>
          </Section>
        )}
      {r.corrections && <Section title="תיקונים"><p style={{ fontSize: 12.5 }}>{r.corrections}</p></Section>}
    </div>
  );
}

/* ── 5. plan ─────────────────────────────────────────────────────────── */

function ArtifactTable({ artifacts, selected, onToggle }: { artifacts: PlannedArtifact[]; selected?: Set<string>; onToggle?: (key: string) => void }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  return (
    <div style={{ display: "grid", gap: 8 }}>
      {artifacts.map((a) => {
        const on = selected ? selected.has(a.key) : a.action !== "skip";
        const isOpen = open[a.key] ?? false;
        return (
          <div key={a.key} className="ob-q" style={{ opacity: on ? 1 : 0.6 }}>
            <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
              {onToggle && <input type="checkbox" checked={on} onChange={() => onToggle(a.key)} style={{ marginTop: 4 }} />}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                  <b style={{ fontSize: 13 }}>{a.title_he}</b>
                  <span className="ob-chip">{ARTIFACT_KIND_HE[a.kind] ?? a.kind}</span>
                  <span className={`ob-chip ${a.action === "skip" ? "" : a.action === "remove" ? "bad" : "ok"}`}>{ACTION_HE[a.action] ?? a.action}</span>
                  <span className={`ob-chip ${a.loading === "always" ? "human" : ""}`}>{LOADING_HE[a.loading] ?? a.loading}</span>
                  <span className="ob-chip">{WRITER_HE[a.writer] ?? a.writer}</span>
                </div>
                <div style={{ marginTop: 4 }}><Code>{a.path}</Code></div>
                <p style={{ fontSize: 12.5, marginTop: 6, lineHeight: 1.55 }}>{a.justification || <span className="ob-sub">ללא הצדקה</span>}</p>
                {a.notes?.length ? <p className="ob-sub" style={{ marginTop: 3 }}>{a.notes.join(" · ")}</p> : null}
                <button type="button" className="ob-toggle" style={{ marginTop: 4 }} onClick={() => setOpen({ ...open, [a.key]: !isOpen })}>{isOpen ? "פחות פרטים" : "צרכנים, מקור אמת, מה מעדכן אותו…"}</button>
                {isOpen && (
                  <div style={{ marginTop: 6, display: "grid", gap: 4, fontSize: 12 }}>
                    <div><b>צרכנים:</b> <Chips items={a.consumers.map((c) => PHASE_HE[c])} /></div>
                    <div><b>מקור האמת:</b> {a.sourceOfTruth}</div>
                    <div><b>מתיישן כשמשתנה:</b> {a.watchedPaths.length ? <span style={{ display: "inline-flex", flexWrap: "wrap", gap: 3 }}>{a.watchedPaths.map((p) => <Code key={p}>{p}</Code>)}</span> : <span className="ob-sub">לא הוגדר</span>}</div>
                    {a.skill && <div><b>Skill:</b> <Code>{a.skill.name}</Code> — {a.skill.description}{a.skill.paths?.length ? <> · paths: {a.skill.paths.map((p) => <Code key={p}>{p}</Code>)}</> : null}{a.skill.disableModelInvocation ? " · הפעלה ידנית בלבד" : ""}</div>}
                    {a.rulePaths?.length ? <div><b>חל על:</b> {a.rulePaths.map((p) => <Code key={p}>{p}</Code>)}</div> : null}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

const STALE_VERDICT_HE: Record<string, string> = { outdated: "לא מעודכן", conflicting: "סותר את הקוד" };

/** Best-effort, display-only: does any proposed (non-skipped) artifact's
 *  own justification mention this warning's path or file name? Never
 *  gates anything — just tells a person what the checkbox itself can't:
 *  whether the AI already proposed something for this specific finding,
 *  or whether it's flagged with no proposed fix at all. */
function addressedByHint(warningPath: string, artifacts: PlannedArtifact[]): PlannedArtifact | null {
  const base = warningPath.split("/").pop() ?? warningPath;
  return artifacts.find((a) => a.action !== "skip" && (a.justification.includes(warningPath) || a.justification.includes(base))) ?? null;
}

export function PlanGate({ r, busy, onSubmit }: GateProps<PlanResult>) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(r.artifacts.filter((a) => a.action !== "skip").map((a) => a.key)));
  const [acked, setAcked] = useState<Set<string>>(new Set());
  const [note, setNote] = useState("");
  const toggle = (k: string) => setSelected((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const toggleAck = (p: string) => setAcked((s) => { const n = new Set(s); if (n.has(p)) n.delete(p); else n.add(p); return n; });
  const always = r.artifacts.filter((a) => selected.has(a.key) && a.loading === "always").length;
  const claudeMdOff = !r.artifacts.some((a) => a.kind === "claude_md" && selected.has(a.key));
  const warnings = r.staleArtifactWarnings ?? [];
  const unacked = warnings.filter((w) => !acked.has(w.path));
  return (
    <div>
      {r.rationale_he && <Note tone="ai">{r.rationale_he}</Note>}
      {warnings.length > 0 && (
        <Section title={`תיעוד AI קיים שנמצא לא מדויק (${warnings.length})`} aside={<span className="ob-sub">{unacked.length ? `${unacked.length} טרם סומנו` : "הכל סומן"}</span>}>
          <Note tone="warn">
            Discovery מצא artifacts קיימים (settings, rules, skills, docs וכו') שנתוניהם כבר לא תואמים את הקוד. <b>סימון ה-checkbox כאן הוא אישור "ראיתי את זה" בלבד — הוא לא מתקן כלום ולא מפעיל שום פעולה.</b> תיקון בפועל, אם ה-AI הציע כזה, מופיע ברשימת ה-artifacts למטה ומסומן שם. <b>אישור התוכנית חסום עד שתסמנו את כולם.</b>
          </Note>
          <ul className="ob-list" style={{ display: "grid", gap: 10, marginTop: 10 }}>
            {warnings.map((w) => {
              const fix = addressedByHint(w.path, r.artifacts);
              return (
                <li key={w.path} style={{ display: "flex", gap: 8, alignItems: "flex-start", border: "1px solid var(--border-hairline)", borderRadius: 8, padding: "8px 10px" }}>
                  <input type="checkbox" checked={acked.has(w.path)} onChange={() => toggleAck(w.path)} style={{ marginTop: 3 }} />
                  <span style={{ flex: 1 }}>
                    <Code>{w.path}</Code> · <b>{STALE_VERDICT_HE[w.verdict] ?? w.verdict}</b>
                    {" · "}
                    <span className={acked.has(w.path) ? "ob-chip" : "ob-chip human"}>{acked.has(w.path) ? "✓ סומן" : "⚠ טרם סומן"}</span>
                    {w.reason && <div className="ob-sub" style={{ marginTop: 4 }}>{w.reason}</div>}
                    <div style={{ marginTop: 4, fontSize: 12 }}>
                      {fix ? <>מטופל על ידי artifact בתוכנית: <b>{fix.title_he}</b> ({fix.path})</> : <span className="ob-sub">לא נמצא artifact בתוכנית שמתייחס במפורש לממצא הזה — אם אתם רוצים שזה יטופל, כתבו על כך בהערה הכללית למטה לפני האישור.</span>}
                    </div>
                  </span>
                </li>
              );
            })}
          </ul>
        </Section>
      )}
      <Section title={`הצעה: ${r.artifacts.length} artifacts — סמנו מה ייווצר`} aside={<span className="ob-sub">{selected.size} נבחרו · {always} נטענים בכל session</span>}>
        <p className="ob-sub" style={{ marginBottom: 8 }}>סימון = ייכתב בשלב הבא; ביטול סימון = לא ייכתב ולא יעלה טוקנים. אפשר לשנות כל בחירה כאן לפני האישור.</p>
        <ArtifactTable artifacts={r.artifacts} selected={selected} onToggle={toggle} />
      </Section>
      {claudeMdOff && <div style={{ marginTop: 10 }}><Note tone="warn">CLAUDE.md הוא ה-artifact היחיד שכל repository מוטמע צריך — ללא סימונו האישור יידחה (אלא אם הוחלט בשלב הגבולות לשמור על הקיים).</Note></div>}
      <Section title={`מה לא ייווצר, ולמה (${r.notCreated.length})`}>
        {r.notCreated.length ? <ul className="ob-list">{r.notCreated.map((n, i) => <li key={i}><b>{ARTIFACT_KIND_HE[n.kind] ?? n.kind}</b> — {n.reason_he}</li>)}</ul> : <Empty text="הכל מוצדק." />}
      </Section>
      {r.protectedGlobs.length > 0 && <Section title="אזורים מוגנים (ל-guardrails)"><div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>{r.protectedGlobs.map((g) => <Code key={g}>{g}</Code>)}</div></Section>}
      <Section title="הערה כללית ל-AI (אופציונלי)">
        <p className="ob-sub" style={{ marginBottom: 6 }}>מועברת כהנחיה נוספת לשלב היצירה — למשל בקשה לטפל בממצא ספציפי, לתקן כפילות בין קבצים, או כל דבר אחר שחשוב שה-AI ייקח בחשבון בסבב הכתיבה הקרוב.</p>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} style={{ width: "100%", fontSize: 13, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border-hairline)" }} placeholder="לדוגמה: אחדו את שני קבצי הכלל של נקודות הכניסה לפלאגין לקובץ אחד מדויק." />
      </Section>
      <div className="ob-actions" style={{ marginTop: 14 }}>
        <button className="btn btn-primary" disabled={busy || unacked.length > 0} onClick={() => onSubmit({ approvedKeys: Array.from(selected), acknowledgedStaleWarnings: Array.from(acked), note: note.trim() || undefined })}>{busy ? "שומר…" : `✓ אשר תוכנית (${selected.size} פריטים) והמשך ליצירה`}</button>
        <span className="ob-sub">{unacked.length > 0 ? `האישור חסום — סמנו את ${unacked.length} ${unacked.length === 1 ? "הממצא" : "הממצאים"} שלא סומנו למעלה.` : "פריטים שלא סומנו לא ייווצרו ולא יעלו טוקנים."}</span>
      </div>
    </div>
  );
}

export function PlanView({ r }: { r: PlanResult }) {
  const list = r.approved ?? r.artifacts;
  const warnings = r.staleArtifactWarnings ?? [];
  return (
    <div>
      {r.rationale_he && <Note tone="ai">{r.rationale_he}</Note>}
      {warnings.length > 0 && (
        <Section title={`תיעוד AI קיים שסומן כלא מדויק (${warnings.length}) — אושר בכל זאת`}>
          <ul className="ob-list">{warnings.map((w) => <li key={w.path}><Code>{w.path}</Code> · <b>{STALE_VERDICT_HE[w.verdict] ?? w.verdict}</b>{w.reason ? ` — ${w.reason}` : ""}</li>)}</ul>
        </Section>
      )}
      <Section title={r.approved ? `התוכנית המאושרת (${list.filter((a) => a.action !== "skip").length} ייווצרו, ${list.filter((a) => a.action === "skip").length} לא)` : "התוכנית המוצעת"} aside={r.approvedAt ? <span className="ob-sub">אושר {fmtDate(r.approvedAt)}</span> : undefined}>
        <ArtifactTable artifacts={list} />
      </Section>
      <Section title={`לא ייווצר (${r.notCreated.length})`}>
        {r.notCreated.length ? <ul className="ob-list">{r.notCreated.map((n, i) => <li key={i}><b>{ARTIFACT_KIND_HE[n.kind] ?? n.kind}</b> — {n.reason_he}</li>)}</ul> : <Empty text="—" />}
      </Section>
    </div>
  );
}

/* ── 6. generate ─────────────────────────────────────────────────────── */

export function GenerateView({ r }: { r: Partial<GenerateResult> }) {
  return (
    <div>
      {r.reviewNoteApplied && <Note tone="info"><b>הערת הסקירה/האימות שיושמה בסבב הזה:</b><pre style={{ whiteSpace: "pre-wrap", margin: "4px 0 0", fontFamily: "inherit", fontSize: 12 }}>{r.reviewNoteApplied}</pre></Note>}
      {r.summary_he && <Section title="מה ה-AI ניסח"><p style={{ fontSize: 12.5, lineHeight: 1.6 }}>{r.summary_he}</p></Section>}
      <Section title="מה נכתב ל-worktree (ו-commit בענף המבודד)">
        <KV items={[{ l: "commit", v: r.commitSha ? <Code>{shortSha(r.commitSha)}</Code> : "—" }, { l: "קבצים שהשתנו ב-git", v: fmtInt(r.filesWritten?.length ?? 0) }, { l: "artifacts", v: fmtInt(r.artifacts?.length ?? 0) }]} />
        {r.artifacts?.length ? (
          <div style={{ marginTop: 10 }}>
            <Table head={["נתיב", "סוג", "פעולה", "כותב", "שורות", "~טוקנים"]}>
              {r.artifacts.map((a) => <tr key={a.key}><td className="path">{a.path}</td><td>{ARTIFACT_KIND_HE[a.kind] ?? a.kind}</td><td>{ACTION_HE[a.action] ?? a.action}</td><td>{a.writer === "ai" ? "AI → DCC" : "DCC"}</td><td>{fmtInt(a.lines)}</td><td>{fmtInt(a.estimatedTokens)}</td></tr>)}
            </Table>
          </div>
        ) : null}
      </Section>
      {r.missing?.length ? <Section title="לא נוצר"><Note tone="warn"><ul className="ob-list">{r.missing.map((m) => <li key={m.key}><Code>{m.path}</Code> — {m.reason_he}</li>)}</ul></Note></Section> : null}
    </div>
  );
}

/* ── 7. validate ─────────────────────────────────────────────────────── */

const READY_HE: Record<ValidateResult["status"], { text: string; tone: "ok" | "warn" | "crit" }> = {
  READY: { text: "מוכן — כל הבדיקות עברו", tone: "ok" }, READY_WITH_WARNING: { text: "מוכן עם אזהרות", tone: "warn" }, NOT_READY: { text: "לא מוכן — נמצאו כשלים", tone: "crit" },
};
const GLYPH: Record<string, string> = { pass: "✓", warn: "!", fail: "✕", skipped: "–" };

export function BudgetBar({ b }: { b: ValidateResult["budget"] }) {
  const pct = Math.min(100, Math.round((b.alwaysLoadedTokens / b.thresholds.failAlways) * 100));
  const cls = b.alwaysLoadedTokens > b.thresholds.failAlways ? "fail" : b.alwaysLoadedTokens > b.thresholds.warnAlways ? "warn" : "";
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
        <span><b>~{fmtInt(b.alwaysLoadedTokens)}</b> טוקנים נטענים בכל session</span>
        <span className="ob-sub">אזהרה מעל {fmtInt(b.thresholds.warnAlways)} · כשל מעל {fmtInt(b.thresholds.failAlways)}</span>
      </div>
      <div className="ob-budget"><i className={cls} style={{ width: `${pct}%` }} /></div>
      <p className="ob-sub" style={{ marginTop: 4 }}>ועוד ~{fmtInt(b.onDemandTokens)} טוקנים נטענים רק לפי דרישה (skills, rules לפי נתיבים, CLAUDE.md מקונן). אומדן: תווים/4.</p>
    </div>
  );
}

export function ValidateView({ r }: { r: ValidateResult }) {
  const ready = READY_HE[r.status];
  return (
    <div>
      <Note tone={ready.tone}><b>{ready.text}</b>{r.attempt > 1 ? ` · ניסיון ${r.attempt}` : ""}</Note>
      <Section title={`בדיקות דטרמיניסטיות (${r.checks.filter((c) => c.status === "pass").length} עברו · ${r.checks.filter((c) => c.status === "warn").length} אזהרות · ${r.checks.filter((c) => c.status === "fail").length} נכשלו)`}>
        <div>
          {r.checks.map((c) => (
            <div key={c.id} className={`ob-check ${c.status}`}>
              <span className="g">{GLYPH[c.status] ?? "?"}</span>
              <div><div>{c.label_he}</div>{c.detail && <div className="d">{c.detail}</div>}</div>
            </div>
          ))}
        </div>
      </Section>
      <Section title="תקציב הקשר">
        <BudgetBar b={r.budget} />
        {r.budget.items.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <Table head={["קובץ", "טעינה", "~טוקנים", "שורות", "הערה"]}>
              {r.budget.items.map((it) => <tr key={it.path}><td className="path">{it.path}</td><td>{LOADING_HE[it.loading] ?? it.loading}</td><td>{fmtInt(it.tokens)}</td><td>{fmtInt(it.lines)}</td><td style={{ fontSize: 11.5 }}>{it.note ?? ""}</td></tr>)}
            </Table>
          </div>
        )}
      </Section>
      <Section title="סקירת AI (קריאה-בלבד: סתירות מול הקוד, טענות לא מבוססות, מידע גנרי)">
        {!r.review ? <Empty text="לא בוצעה." /> : (
          <div style={{ display: "grid", gap: 8 }}>
            <span className={`ob-chip ${r.review.overall_status === "PASS" ? "ok" : r.review.overall_status === "FAIL" ? "bad" : "human"}`} style={{ justifySelf: "start" }}>{r.review.overall_status} · {r.review.issues.length} ממצאים</span>
            {r.review.strengths_he?.length ? <ul className="ob-list">{r.review.strengths_he.map((s, i) => <li key={i} style={{ color: "var(--status-healthy)" }}>{s}</li>)}</ul> : null}
            {r.review.issues.length > 0 && (
              <Table head={["חומרה", "artifact", "הבעיה", "ראיה", "תיקון מומלץ"]}>
                {r.review.issues.map((i, k) => <tr key={k}><td><Pill tone={i.severity === "high" ? "critical" : i.severity === "medium" ? "warning" : "inactive"}>{i.severity}</Pill></td><td className="path">{i.artifact}</td><td style={{ fontSize: 12 }}>{i.problem_he}</td><td style={{ fontSize: 11.5 }}>{i.evidence ?? "—"}</td><td style={{ fontSize: 11.5 }}>{i.recommended_correction_he ?? "—"}</td></tr>)}
              </Table>
            )}
          </div>
        )}
      </Section>
      {r.fixNote && <Section title="מה נשלח לסבב התיקון"><pre style={{ whiteSpace: "pre-wrap", fontSize: 12, background: "var(--surface-muted)", padding: 10, borderRadius: 8, margin: 0, fontFamily: "inherit" }}>{r.fixNote}</pre></Section>}
    </div>
  );
}

/* ── 8. review ───────────────────────────────────────────────────────── */

export function DiffViewer({ repoId, runId, path }: { repoId: string; runId: string; path: string }) {
  const [state, setState] = useState<{ diff: string; binary: boolean } | { error: string } | null>(null);
  useEffect(() => {
    setState(null);
    getOnboardingDiff(repoId, runId, path).then((d) => setState({ diff: d.diff, binary: d.binary })).catch((e) => setState({ error: errText(e) }));
  }, [repoId, runId, path]);
  if (!state) return <p className="ob-sub">טוען diff…</p>;
  if ("error" in state) return <p style={{ fontSize: 12, color: "var(--status-critical)" }}>{state.error}</p>;
  if (state.binary) return <p className="ob-sub">קובץ בינארי.</p>;
  if (!state.diff.trim()) return <p className="ob-sub">אין הבדל מול ה-commit הבסיסי.</p>;
  return (
    <pre className="ob-diff">
      {state.diff.split("\n").map((line, i) => {
        const cls = line.startsWith("+++") || line.startsWith("---") || line.startsWith("diff ") || line.startsWith("index ") || line.startsWith("new file") || line.startsWith("deleted file") ? "meta"
          : line.startsWith("@@") ? "hunk" : line.startsWith("+") ? "add" : line.startsWith("-") ? "del" : "";
        return <span key={i} className={cls}>{line || " "}</span>;
      })}
    </pre>
  );
}

function ReviewSummary({ r }: { r: ReviewResult }) {
  const ready = READY_HE[r.validation.status];
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <KV items={[
        { l: "אימות", v: <span style={{ color: ready.tone === "ok" ? "var(--status-healthy)" : ready.tone === "warn" ? "var(--status-warning)" : "var(--status-critical)" }}>{ready.text}</span> },
        { l: "בדיקות (עבר / אזהרה / נכשל)", v: `${r.validation.passed} / ${r.validation.warned} / ${r.validation.failed}` },
        { l: "סקירת AI", v: r.validation.reviewStatus ? `${r.validation.reviewStatus} · ${r.validation.issueCount} ממצאים` : "לא בוצעה" },
        { l: "commit בסיס", v: <Code>{shortSha(r.baselineSha)}</Code> },
      ]} />
      {r.budget && <BudgetBar b={r.budget} />}
    </div>
  );
}

export function ReviewGate({ repoId, runId, r, busy, onSubmit }: GateProps<ReviewResult> & { repoId: string; runId: string }) {
  const [openPath, setOpenPath] = useState<string | null>(null);
  const [drop, setDrop] = useState<Set<string>>(new Set());
  const [note, setNote] = useState("");
  const toggleDrop = (p: string) => setDrop((s) => { const n = new Set(s); if (n.has(p)) n.delete(p); else n.add(p); return n; });
  const unproduced = r.planned.filter((p) => !p.produced);
  return (
    <div>
      <ReviewSummary r={r} />
      <Section title={`ה-diff המלא — ${r.changedFiles.length} קבצים מול ה-commit הבסיסי`} aside={<span className="ob-sub">עד כאן שום דבר לא עזב את המחשב</span>}>
        {r.changedFiles.length === 0 ? <Note tone="warn">אין שינויים בענף — אין מה למסור.</Note> : (
          <div style={{ display: "grid", gap: 6 }}>
            {r.changedFiles.map((f) => (
              <div key={f.path} className="ob-q" style={{ padding: "8px 12px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <span className={`ob-chip ${f.status === "D" ? "bad" : f.status === "A" ? "ok" : ""}`}>{FILE_STATUS_HE[f.status] ?? f.status}</span>
                  <Code>{f.path}</Code>
                  <span className="ob-sub" style={{ direction: "ltr" }}>+{f.additions} −{f.deletions}</span>
                  <span style={{ flex: 1 }} />
                  <button type="button" className="ob-toggle" onClick={() => setOpenPath(openPath === f.path ? null : f.path)}>{openPath === f.path ? "הסתר diff" : "הצג diff"}</button>
                  {f.status !== "D" && (
                    <label style={{ fontSize: 11.5, display: "inline-flex", gap: 5, alignItems: "center", cursor: "pointer", color: drop.has(f.path) ? "var(--status-critical)" : "var(--ink-500)" }}>
                      <input type="checkbox" checked={drop.has(f.path)} onChange={() => toggleDrop(f.path)} /> הסר מה-PR
                    </label>
                  )}
                </div>
                {openPath === f.path && <div style={{ marginTop: 8 }}><DiffViewer repoId={repoId} runId={runId} path={f.path} /></div>}
              </div>
            ))}
          </div>
        )}
      </Section>
      <Section title="תוכנית מול מה שנוצר בפועל">
        <Table head={["artifact", "נתיב", "פעולה", "נוצר?", "שורות", "~טוקנים"]}>
          {r.planned.map((p) => <tr key={p.key}><td>{ARTIFACT_KIND_HE[p.kind] ?? p.kind}</td><td className="path">{p.path}</td><td>{ACTION_HE[p.action] ?? p.action}</td><td>{p.produced ? <span style={{ color: "var(--status-healthy)", fontWeight: 700 }}>✓</span> : <span style={{ color: "var(--status-critical)", fontWeight: 700 }}>✕</span>}</td><td>{p.lines != null ? fmtInt(p.lines) : "—"}</td><td>{p.estimatedTokens != null ? fmtInt(p.estimatedTokens) : "—"}</td></tr>)}
        </Table>
        {unproduced.length > 0 && <p className="ob-sub" style={{ marginTop: 6 }}>{unproduced.length} פריטים מהתוכנית לא נוצרו — ראו "לא נוצר" למטה.</p>}
      </Section>
      <Section title={`לא נוצר בכוונה (${r.notCreated.length})`}>
        {r.notCreated.length ? <ul className="ob-list">{r.notCreated.map((n, i) => <li key={i}><b>{ARTIFACT_KIND_HE[n.kind] ?? n.kind}</b> — {n.reason_he}</li>)}</ul> : <Empty text="—" />}
      </Section>
      <div className="field" style={{ marginTop: 12 }}>
        <label>הערה (חובה בבקשת שינויים — היא נשלחת ליצירה מחדש; אופציונלית באישור)</label>
        <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="מה צריך להשתנות? למשל: CLAUDE.md ארוך מדי, להוריד את סעיף הארכיטקטורה ל-skill; ה-rule על migrations לא נכון" />
      </div>
      <div className="ob-actions" style={{ marginTop: 12 }}>
        {drop.size > 0
          ? <button className="btn btn-primary" disabled={busy} onClick={() => onSubmit({ decision: "approve", dropPaths: Array.from(drop), note: note.trim() || undefined })}>{busy ? "מבצע…" : `הסר ${drop.size} קבצים ואמת מחדש`}</button>
          : <button className="btn btn-primary" disabled={busy || r.changedFiles.length === 0} onClick={() => onSubmit({ decision: "approve", note: note.trim() || undefined })}>{busy ? "מבצע…" : "✓ אשר ופתח Pull Request"}</button>}
        <button className="btn btn-secondary" disabled={busy || !note.trim()} title={!note.trim() ? "כתבו מה צריך להשתנות" : undefined} onClick={() => onSubmit({ decision: "request_changes", note: note.trim() })}>בקש שינויים (חזרה ליצירה)</button>
        <span className="ob-sub">האישור דוחף ענף ופותח PR — פעולה גלויה, ניתנת לביטול. המיזוג נשאר בידיים אנושיות.</span>
      </div>
    </div>
  );
}

export function ReviewView({ r }: { r: ReviewResult }) {
  return (
    <div>
      <ReviewSummary r={r} />
      <Section title="ההחלטה">
        {r.decision === "approve" && <Note tone="ok">אושר {fmtDate(r.decidedAt)}{r.note ? ` — ${r.note}` : ""}</Note>}
        {r.decision === "request_changes" && <Note tone="warn">התבקשו שינויים {fmtDate(r.decidedAt)}: {r.note}</Note>}
        {!r.decision && r.droppedPaths?.length ? <Note tone="info">הוסרו {r.droppedPaths.length} קבצים ({r.droppedPaths.join(", ")}) — האימות רץ מחדש.</Note> : null}
        {!r.decision && !r.droppedPaths?.length && <Empty text="טרם הוחלט." />}
      </Section>
      <Section title={`קבצים בענף (${r.changedFiles.length})`}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>{r.changedFiles.map((f) => <Code key={f.path}>{f.path}</Code>)}</div>
      </Section>
    </div>
  );
}

/* ── 9. deliver ──────────────────────────────────────────────────────── */

export function DeliverView({ r }: { r: DeliverResult }) {
  return (
    <div>
      {r.merged
        ? <Note tone="ok"><b>ה-Repository מוכן ל-AI.</b> הענף מוזג ל-<Code>{r.base}</Code> (commit <Code>{shortSha(r.mergedSha)}</Code>) · {fmtDate(r.readinessDate)} · מתודולוגיה {r.onboardingVersion} · נותח מ-commit <Code>{shortSha(r.analyzedCommitSha)}</Code>.</Note>
        : r.localOnly
          ? <Note tone="warn">ל-repository אין remote — הענף <Code>{r.branch}</Code> קיים מקומית בלבד. מזגו אותו ל-<Code>{r.base}</Code> (git merge) ולחצו "בדוק שוב".</Note>
          : <Note tone="info">הענף נדחף. DCC לא ממזג — כשה-PR ימוזג ב-Git, לחצו "בדוק שוב" וה-Repository יסומן כמוכן ל-AI.</Note>}
      <div style={{ marginTop: 10 }}>
        <KV items={[
          { l: "ענף → בסיס", v: <span><Code>{r.branch}</Code> → <Code>{r.base}</Code></span> },
          { l: "נדחף", v: r.pushed ? "כן" : "לא" },
          { l: "Pull Request", v: r.prUrl ? <a href={r.prUrl} target="_blank" rel="noreferrer">#{r.prNumber ?? ""} ↗</a> : r.compareUrl ? <a href={r.compareUrl} target="_blank" rel="noreferrer">פתחו PR ידנית ↗</a> : "—" },
          { l: "נוצר דרך gh", v: r.createdViaGh ? "כן" : "לא" },
          { l: "בדיקות מיזוג", v: `${r.checks} · אחרונה ${fmtDate(r.lastCheckedAt)}` },
          { l: "מיזוג", v: r.merged ? "מוזג" : "טרם" },
        ]} />
      </div>
    </div>
  );
}

/* ── dispatcher ──────────────────────────────────────────────────────── */

export function StageFindings({ repoId, runId, stageKey, status, result, waiting, busy, mode, onSubmit }: {
  repoId: string; runId: string; stageKey: string; status: OnboardingStatus; result: unknown; waiting: boolean; busy: boolean; mode: "initial" | "refresh";
  onSubmit: (input: unknown) => Promise<void>;
}) {
  if (result === null || result === undefined) return null;
  switch (stageKey) {
    case "scan": return <ScanView r={result as ScanResult} mode={mode} />;
    case "boundaries": return waiting ? <BoundariesGate r={result as BoundariesResult} busy={busy} onSubmit={onSubmit} /> : <BoundariesView r={result as BoundariesResult} />;
    case "discovery": return <DiscoveryView r={result as DiscoveryResult} />;
    case "confirm": return waiting ? <ConfirmGate r={result as ConfirmResult} busy={busy} onSubmit={onSubmit} /> : <ConfirmView r={result as ConfirmResult} status={status} />;
    case "plan": return waiting ? <PlanGate r={result as PlanResult} busy={busy} onSubmit={onSubmit} /> : <PlanView r={result as PlanResult} />;
    case "generate": return <GenerateView r={result as Partial<GenerateResult>} />;
    case "validate": return <ValidateView r={result as ValidateResult} />;
    case "review": return waiting ? <ReviewGate repoId={repoId} runId={runId} r={result as ReviewResult} busy={busy} onSubmit={onSubmit} /> : <ReviewView r={result as ReviewResult} />;
    case "deliver": return <DeliverView r={result as DeliverResult} />;
    default: return null;
  }
}
