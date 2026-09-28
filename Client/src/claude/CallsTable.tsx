import { useState } from "react";
import type { ClaudeCallView } from "../api.ts";
import { Pill } from "../ui.tsx";
import { CostLine } from "./CostLine.tsx";
import { capabilityLabel, fmtDuration, fmtInt, fmtUsd, fmtWhen, outcomeOf, screenLabel, triggerLabel } from "./labels.ts";

/**
 * The ledger as a table — the same rows wherever calls are listed: the
 * control center, a requirement's cost detail, an onboarding run's rail.
 * A row opens to show what the policy decided, the cache share, the
 * outcome and the identifiers; nothing here is computed differently from
 * the row itself.
 */
export function CallsTable({ rows, showClient = true, showWho = true, showOn = true, nav, emptyText }: {
  rows: ClaudeCallView[];
  showClient?: boolean;
  showWho?: boolean;
  showOn?: boolean;
  nav?: (h: string) => void;
  emptyText?: string;
}) {
  const [open, setOpen] = useState<string | null>(null);
  if (rows.length === 0) return <div className="empty">{emptyText ?? "עדיין לא נרשמה אף קריאה."}</div>;
  return (
    <table className="wtable calls">
      <thead>
        <tr>
          <th>מתי</th>
          {showWho && <th>מי</th>}
          {showOn && <th>{showClient ? "לקוח · על מה" : "על מה"}</th>}
          <th>יכולת</th>
          <th>מודל · מאמץ</th>
          <th className="num">טוקנים ↑ ↓ (מטמון)</th>
          <th className="num">עלות</th>
          <th className="num">זמן</th>
          <th>תוצאה</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const o = outcomeOf(r.outcome);
          const isOpen = open === r.id;
          const cacheAll = r.inputTokens + r.cacheReadTokens + r.cacheWriteTokens;
          const on = r.workitemTitle ?? (r.entityKind === "onboarding_run" ? "הטמעת מאגר" : r.entityKind === "conversation" ? "שיחה" : r.entityKind === "none" ? "המערכת" : r.entityKind);
          return [
            <tr key={r.id} className={isOpen ? "open" : undefined} onClick={() => setOpen(isOpen ? null : r.id)} style={{ cursor: "pointer" }}>
              <td style={{ whiteSpace: "nowrap" }}>{fmtWhen(r.startedAt)}</td>
              {showWho && <td>{r.userName}</td>}
              {showOn && <td>{showClient ? <>{r.clientName} · </> : null}{on} <span className="muted small">· {screenLabel(r.screen ?? r.entityKind)}</span></td>}
              <td>{capabilityLabel(r.capability)} {r.trigger !== "button" && <span className="ob-chip ai">{triggerLabel(r.trigger)}</span>}{r.policyRule?.includes("escalated") && <span className="ob-chip bad">הוסלם</span>}</td>
              <td style={{ whiteSpace: "nowrap" }}><CostLine model={r.modelUsed ?? r.modelRequested} effort={r.effort} costUsd={0} note="" /></td>
              <td className="num mono">{fmtInt(r.inputTokens)} ↑ {fmtInt(r.outputTokens)} ↓{r.cacheReadTokens ? ` (${fmtInt(r.cacheReadTokens)})` : ""}</td>
              <td className="num">{fmtUsd(r.costUsd)}</td>
              <td className="num">{fmtDuration(r.durationMs)}</td>
              <td><Pill tone={o.tone}>{o.label}</Pill></td>
            </tr>,
            isOpen ? (
              <tr key={`${r.id}-x`} className="open">
                <td colSpan={9} style={{ paddingTop: 0 }}>
                  <div className="ob-explain" style={{ marginTop: 0, gridTemplateColumns: "1fr 1fr", background: "var(--surface)" }}>
                    <div><b>יוזמה</b><span>{triggerLabel(r.trigger)} · {r.userName}{r.conversationId && nav ? <> · <a onClick={(e) => { e.stopPropagation(); nav(`#/claude/conversations/${r.conversationId}`); }}>לשיחה</a></> : null}</span></div>
                    <div><b>מדיניות</b><span>{r.policyRule ?? "—"}{r.policyVersion != null ? ` · גרסה ${r.policyVersion}` : ""}</span></div>
                    <div><b>תוצאה</b><span>{o.label}{r.errorText ? ` — ${r.errorText}` : ""}{r.unanswered ? " · המודל אמר שאין לו את זה במסך" : ""}</span></div>
                    <div><b>מטמון</b><span>{cacheAll > 0 ? `${fmtInt(r.cacheReadTokens)} מתוך ${fmtInt(cacheAll)} טוקני קלט נקראו מהמטמון (${Math.round((r.cacheReadTokens / cacheAll) * 100)}%)` : "—"}{r.cacheWriteTokens ? ` · ${fmtInt(r.cacheWriteTokens)} נכתבו` : ""}</span></div>
                    <div><b>על מה</b><span>{r.label || on}{r.workitemId && nav ? <> · <a onClick={(e) => { e.stopPropagation(); nav(`#/wi/${r.workitemId}`); }}>לדרישה</a></> : null}{r.numTurns != null ? ` · ${r.numTurns} צעדים` : ""}</span></div>
                    <div><b>מזהה</b><span className="mono">{r.id}{r.sourceRef ? ` · ${r.sourceRef}` : ""}</span></div>
                  </div>
                </td>
              </tr>
            ) : null,
          ];
        })}
      </tbody>
    </table>
  );
}
