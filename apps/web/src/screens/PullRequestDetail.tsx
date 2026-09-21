import { useCallback, useEffect, useState } from "react";
import { cachedPullRequest, getPullRequest, getPullRequestFile, getPullRequestQuick, getRepoBranches, mergePullRequest, submitPullRequestReview, type ConflictView, type ReviewDecision, type BranchHealth, type RepoBranches, type PullRequestQuick, type PrBlocker, type FileGroup, type PullRequestDetail as Detail, type TimelineItem } from "../api.ts";
import { CodeMapPanel } from "../components/CodeMap.tsx";
import { FileCompare } from "../components/FileCompare.tsx";
import { TopicRows } from "../components/Topics.tsx";
import { useClaudeContext } from "../claude/context.ts";
import { CardTitle, PrNumber } from "../ui.tsx";
import { Info } from "../claude/Info.tsx";
import { errText } from "./onboarding/labels.ts";

/**
 * One pull request, on a screen of its own (screens 2 to 5 of
 * `openspec/changes/pull-request-center`): what blocks the merge, what to do
 * next, the code map, the files, the timeline and the repository's branches.
 *
 * It answers, in this order: is it safe to merge, what should I do, and only
 * then the detail — the order a person actually asks in.
 */

export type Tab = "overview" | "files" | "timeline" | "branches";
const TABS: { key: Tab; label: string }[] = [
  { key: "overview", label: "סקירה" },
  { key: "files", label: "קבצים" },
  { key: "timeline", label: "יומן" },
  { key: "branches", label: "ענפים" },
];

const fmtDate = (iso: string) => new Date(iso).toLocaleString("he-IL", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" });
function waited(hours: number): string {
  if (hours < 1) return "עודכן ממש עכשיו";
  if (hours < 24) return `ממתין ${Math.round(hours)} שעות`;
  const d = Math.round(hours / 24);
  return d === 1 ? "ממתין יום" : `ממתין ${d} ימים`;
}

function BlockerRow({ b }: { b: PrBlocker }) {
  const tone = b.ok === true ? "yes" : b.ok === false ? "no" : "na";
  return (
    <div className="pr-chk">
      <span className={`ic ${tone}`}>{b.ok === true ? "✓" : b.ok === false ? "✕" : "–"}</span>
      <div><div className="tt">{b.title}</div><div className="dd">{b.detail}</div></div>
    </div>
  );
}

/** "יש התנגשות" tells a person nothing to act on. This says where: which files, and how big each side's change in them is. */
function ConflictPanel({ conflict, loading, url, base }: { conflict: ConflictView | null; loading: boolean; url: string; base: string }) {
  // Each side's numbers keep their own left-to-right order inside the Hebrew line.
  const side = (s: { additions: number; deletions: number } | null) => (s ? <bdi dir="ltr"><span className="plus">+{s.additions}</span> <span className="minus">−{s.deletions}</span></bdi> : "—");
  const named = (n: string) => <bdi dir="ltr">{n}</bdi>;
  return (
    <div className="panel" style={{ marginBottom: 12 }}>
      <CardTitle info="pr_conflict_files">{conflict && !conflict.exact ? "קבצים חשודים בהתנגשות" : "הקבצים בהתנגשות"}</CardTitle>
      {loading && <p className="ob-sub">בודק אילו קבצים מתנגשים…</p>}
      {!loading && !conflict?.files.length && <p className="ob-sub">הגיט־האוסט אומר שיש התנגשות, אבל לא הצלחנו לזהות באילו קבצים. פתחו את הבקשה בגיט־האוסט כדי לראות אותה.</p>}
      {conflict && conflict.files.length > 0 && (
        <>
          <p className="ob-sub" style={{ marginBottom: 6 }}>
            {conflict.exact
              ? `${conflict.files.length === 1 ? "קובץ אחד" : `${conflict.files.length} קבצים`} שבהם הענף ו-${base} שינו את אותן שורות. בכל אחד מהם צריך להחליט איזו גרסה נשארת.`
              : `אלה הקבצים ששני הצדדים שינו. ההתנגשות באחד מהם או יותר — אין לנו כאן ודאות באיזה, כי אין למערכת עותק מקומי של המאגר לחשב את המיזוג.`}
          </p>
          {conflict.files.map((f) => (
            <div className="pr-chk" key={f.path} style={{ alignItems: "flex-start" }}>
              <span className="ic no">✕</span>
              <div style={{ minWidth: 0 }}>
                <div className="tt ob-code" style={{ overflowWrap: "anywhere" }}>{f.path}</div>
                <div className="dd">הענף: {side(f.ours)} · {named(base)}: {side(f.theirs)}</div>
              </div>
            </div>
          ))}
          <p className="ob-sub" style={{ marginTop: 8 }}>
            המערכת לא מכריעה בשבילכם: מי שעובד על הענף מעדכן אותו מ-{base} ובוחר לכל קובץ איזו גרסה נשארת. אפשר גם{" "}
            <a href={url} target="_blank" rel="noreferrer">לפתוח את הבקשה בגיט־האוסט ↗</a>, שם יש כלי הכרעה.
          </p>
        </>
      )}
    </div>
  );
}

function Files({ groups, count, url, repoId, number }: { groups: FileGroup[]; count: number; url: string; repoId: string; number: number }) {
  const [only, setOnly] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const shown = only ? groups.filter((g) => g.key === only) : groups;
  const add = groups.reduce((n, g) => n + g.additions, 0);
  const del = groups.reduce((n, g) => n + g.deletions, 0);
  return (
    <>
      <div className="pr-fhead">
        <div><b>{count} קבצים</b> <span className="l">· <span className="plus">+{add}</span> <span className="minus">−{del}</span></span></div>
        <div className="pr-chips">
          <button type="button" className={`chip${only === null ? " on" : ""}`} onClick={() => setOnly(null)}>הכל</button>
          {groups.map((g) => (
            <button key={g.key} type="button" className={`chip${only === g.key ? " on" : ""}`} onClick={() => setOnly(g.key)}>{g.title} {g.files.length}</button>
          ))}
        </div>
      </div>
      {shown.map((g) => (
        <div className="panel pr-grp" key={g.key}>
          <div className="gh">
            <b>{g.title}</b>
            <span className="l">{g.files.length} קבצים{g.note ? ` · ${g.note}` : ""}</span>
            <span className="l" style={{ marginInlineStart: "auto" }}><span className="plus">+{g.additions}</span> <span className="minus">−{g.deletions}</span></span>
          </div>
          {g.files.slice(0, 30).map((f) => (
            <div key={f.path}>
              <div className={`pr-file-row click${open === f.path ? " open" : ""}`} role="button" tabIndex={0} aria-expanded={open === f.path}
                onClick={() => setOpen(open === f.path ? null : f.path)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(open === f.path ? null : f.path); } }}>
                <span className={`st ${f.status === "A" ? "a" : f.status === "D" ? "d" : "m"}`}>{f.status}</span>
                <span className="path">{f.path}</span>
                {f.note && <span className="pill warning">{f.note}</span>}
                <span className="plus">+{f.additions}</span>
                <span className="minus">−{f.deletions}</span>
              </div>
              {open === f.path && <div className="pr-file-open"><FileCompare load={() => getPullRequestFile(repoId, number, f.path)} /></div>}
            </div>
          ))}
          {g.files.length > 30 && <div className="pr-file-row"><span className="l">ועוד {g.files.length - 30} קבצים בקבוצה הזו</span></div>}
        </div>
      ))}
      <p className="ob-sub">לחצו על קובץ כדי לראות אותו לפני ואחרי. הסקירה עצמה, ההערות והאישור נעשים בגיט־האוסט. <a href={`${url}/files`} target="_blank" rel="noreferrer">פתח את השינויים ב-GitHub ↗</a></p>
    </>
  );
}

/** What a person has ticked while reviewing, kept while they move between the tabs of one request. */
const reviewProgress = new Map<string, { open: boolean; checked: string[] }>();

type Step = { key: string; title: string; detail: string; go?: () => void; goText?: string };

/**
 * Reviewing and deciding, in one place: what to look at before deciding, and then
 * the decision itself, which is sent to the host as a real review
 * (`openspec/changes/pull-request-center`). The steps are what a person says they
 * did — DCC cannot know they read anything — so they are there to slow the
 * decision down, not to prove it.
 */
function ReviewFlow({ repoId, number, base, blockers, steps, onFiles, onDone }: {
  repoId: string; number: number; base: string; blockers: PrBlocker[]; steps: Step[]; onFiles: () => void; onDone: () => void;
}) {
  const key = `${repoId}:${number}`;
  const saved = reviewProgress.get(key);
  const [open, setOpen] = useState(saved?.open ?? false);
  const [checked, setChecked] = useState<string[]>(saved?.checked ?? []);
  const [decision, setDecision] = useState<ReviewDecision | "merge" | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  useEffect(() => { reviewProgress.set(key, { open, checked }); }, [key, open, checked]);

  // Everything except the missing approval — that is what this flow is about to give.
  const stuck = blockers.filter((b) => b.key !== "review" && b.ok === false);
  const done = steps.filter((st) => checked.includes(st.key)).length;
  const ready = done === steps.length;
  const toggle = (k: string) => setChecked((c) => (c.includes(k) ? c.filter((x) => x !== k) : [...c, k]));

  const options: { key: ReviewDecision | "merge"; title: string; text: string }[] = [
    { key: "approve", title: `מאשר מיזוג ל-${base}`, text: "השינוי טוב. אישור רשמי בגיט־האוסט, והמיזוג נפתח אם אין חסמים אחרים." },
    { key: "request_changes", title: "לא מאשר, צריך תיקון", text: "השינוי לא מוכן. הבקשה מסומנת באדום, והכותב צריך לתקן ולשלוח שוב. חובה לכתוב מה לתקן." },
    { key: "comment", title: "רק הערה", text: "כותבים מה חשבתם, בלי להחליט. הבקשה נשארת פתוחה." },
    { key: "merge", title: `ממזג ל-${base} בלי אישור סקירה`, text: "השינוי נכנס עכשיו, בלי אישור רשמי. זה זמני: הגיט־האוסט לא נותן לחשבון ש-DCC עובד בו לאשר בקשה שהוא פתח. המיזוג הוא מיזוג אמיתי בגיט־האוסט, ואי אפשר לבטל אותו מכאן." },
  ];
  const needsText = decision === "comment" || decision === "request_changes";

  const finish = async () => {
    if (!decision) return;
    setBusy(true); setErr(null); setSent(null);
    try {
      if (decision === "merge") await mergePullRequest(repoId, number);
      else await submitPullRequestReview(repoId, number, decision, text);
      setSent(decision === "merge" ? `הבקשה מוזגה ל-${base}.` : decision === "approve" ? "האישור נשלח לגיט־האוסט." : decision === "request_changes" ? "הבקשה סומנה כדורשת תיקון, והכותב יקבל את ההערה." : "ההערה נשלחה לגיט־האוסט.");
      setDecision(null); setText(""); setChecked([]); setOpen(false);
      onDone();
    } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };

  if (!open) {
    return (
      <div className="panel rv" style={{ marginBottom: 12 }}>
        <div className="rv-head">
          <div style={{ flex: 1, minWidth: 0 }}>
            <CardTitle info="pr_review" style={{ margin: 0 }}>סקירה ואישור</CardTitle>
            <p className="ob-sub" style={{ marginTop: 3 }}>הבקשה פתוחה ומוכנה לסקירה. התהליך יעבור אתכם על מה שנכנס, ובסוף תחליטו.</p>
          </div>
          <button className="btn btn-primary" onClick={() => setOpen(true)}>התחל בתהליך אישור PR</button>
        </div>
        {sent && <div className="ob-note ok" style={{ marginTop: 8 }}>{sent}</div>}
      </div>
    );
  }

  return (
    <div className="panel rv" style={{ marginBottom: 12 }}>
      <div className="rv-head">
        <CardTitle info="pr_review" style={{ margin: 0 }}>סקירה ואישור · בקשה #{number}</CardTitle>
        <span className="ob-sub">עברתם על {done} מתוך {steps.length}</span>
        <span style={{ flex: 1 }} />
        <button className="btn btn-secondary btn-sm" onClick={() => setOpen(false)}>צא מהסקירה</button>
      </div>

      <div className="panel rv-in" style={{ marginBottom: 10 }}>
        <CardTitle info="pr_review_checklist">מה לבדוק לפני שמחליטים</CardTitle>
        <div className="pr-chk">
          <span className={`ic ${stuck.length ? "no" : "yes"}`}>{stuck.length ? "✕" : "✓"}</span>
          <div>
            <div className="tt">{stuck.length ? "יש חסמים פתוחים חוץ מהאישור" : "אין חסמים אדומים חוץ מהאישור"}</div>
            <div className="dd">{stuck.length ? stuck.map((b) => b.title).join(" · ") : "DCC בדק בשבילכם"}</div>
          </div>
        </div>
        {steps.map((st) => {
          const on = checked.includes(st.key);
          return (
            <button type="button" key={st.key} className="pr-chk rv-row" aria-pressed={on} onClick={() => toggle(st.key)}>
              <span className={`ic ${on ? "yes" : "box"}`}>{on ? "✓" : "☐"}</span>
              <div>
                <div className="tt">{st.title}</div>
                <div className="dd">
                  {st.detail}
                  {st.go && <> · <span className="rv-link" role="link" tabIndex={0}
                    onClick={(e) => { e.stopPropagation(); st.go!(); }}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); st.go!(); } }}>{st.goText}</span></>}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <div className="panel rv-in">
        <CardTitle info="pr_decision">ההחלטה שלכם</CardTitle>
        {!ready
          ? <div className="rv-lock">סמנו את השורות למעלה, וההחלטה תיפתח. <button type="button" className="rv-link" onClick={onFiles}>או פתחו קודם את הקבצים</button></div>
          : (
            <>
              <div className="rv-opts" role="radiogroup" aria-label="החלטה">
                {options.map((o) => (
                  <button key={o.key} type="button" role="radio" aria-checked={decision === o.key} className={`rv-o${decision === o.key ? " on" : ""}`}
                    disabled={o.key === "merge" && stuck.length > 0} onClick={() => setDecision(o.key)}>
                    <b>{o.title}</b>{o.text}
                  </button>
                ))}
              </div>
              {decision !== "merge" && <textarea className="rv-ta" value={text} onChange={(e) => setText(e.target.value)} rows={3}
                placeholder={needsText ? "מה חשבתם? כתבו כאן" : "אפשר להוסיף הערה (לא חובה)"} />}
              {err && <div className="ob-note crit" style={{ marginTop: 8 }}>{err}</div>}
              <div className="ob-actions" style={{ marginTop: 8 }}>
                <button className="btn btn-primary btn-sm" disabled={!decision || busy || (needsText && !text.trim())} onClick={() => void finish()}>{busy ? "שולח…" : decision === "merge" ? "מזג עכשיו" : "סיים סקירה"}</button>
                <span className="ob-sub" style={{ alignSelf: "center" }}>{stuck.length ? "מיזוג בלי אישור נפתח רק כשאין חסמים אחרים. " : ""}ההחלטה נשלחת לגיט־האוסט, והמסך מתרענן.</span>
              </div>
            </>
          )}
      </div>
    </div>
  );
}

const BRANCH_STATUS: Record<BranchHealth["status"], { label: string; pill: string }> = {
  default: { label: "ראשי", pill: "neutral" },
  open_pr: { label: "בקשה פתוחה", pill: "active" },
  work: { label: "בעבודה", pill: "neutral" },
  stale: { label: "נסגרה בלי מיזוג", pill: "warning" },
  merged: { label: "כבר מוזג", pill: "healthy" },
};

function Branches({ repoId }: { repoId: string }) {
  const [data, setData] = useState<RepoBranches | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async (refresh?: boolean) => {
    setBusy(true);
    try { setData(await getRepoBranches(repoId, refresh)); setErr(null); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }, [repoId]);
  useEffect(() => { void load(); }, [load]);

  const count = (s: BranchHealth["status"]) => data?.rows.filter((r) => r.status === s).length ?? 0;
  return (
    <>
      <div className="panel" style={{ marginBottom: 12 }}>
        <CardTitle info="branch">מה זה ענף, ולמה יש כאלה</CardTitle>
        <p className="ob-sub">
          ענף הוא עותק עבודה מקביל של הריפו. כל מי שמתחיל עבודה — אדם, סשן של Claude Code או הרצה של DCC — פותח לעצמו ענף, כדי לא לשבור את
          {data ? ` ${data.defaultBranch}` : " הענף הראשי"}. כשהעבודה מוכנה, בקשת מיזוג מכניסה אותה לענף הראשי, ואז הענף כבר לא נחוץ.
          ענפים לא נמחקים לבד, ולכן הם מצטברים. כאן רואים איפה כל אחד עומד.
        </p>
      </div>
      {err && <div className="ob-note crit" style={{ marginBottom: 10 }}>{err}</div>}
      {!data && !err && <div className="panel"><p className="ob-sub"><span className="spinner" style={{ width: 13, height: 13, marginInlineEnd: 8, verticalAlign: "middle" }} />טוען את הענפים מהגיט־האוסט…</p></div>}
      {data && (
        <>
          <div className="pr-tiles">
            <div><div className="l">בקשה פתוחה<Info k="prs_open" /></div><div className="v">{count("open_pr")}</div></div>
            <div><div className="l">בעבודה</div><div className="v">{count("work")}</div></div>
            <div><div className="l">נסגרו בלי מיזוג</div><div className="v" style={{ color: count("stale") ? "var(--status-warning)" : undefined }}>{count("stale")}</div></div>
            <div><div className="l">אפשר למחוק<Info k="branch_deletable" /></div><div className="v" style={{ color: count("merged") ? "var(--status-healthy)" : undefined }}>{count("merged")}</div></div>
          </div>
          <div className="panel" style={{ padding: 0, overflow: "hidden" }}>
            <div className="pr-group">
              <b>{data.rows.length} ענפים</b>
              <button className="btn btn-secondary btn-sm" style={{ marginInlineStart: "auto" }} disabled={busy} onClick={() => void load(true)}>{busy ? "מסנכרן…" : "↻ סנכרן"}</button>
            </div>
            {data.rows.map((b) => (
              <div className="pr-br" key={b.name}>
                <div className="top">
                  <span className="ob-code" style={{ minWidth: 0, overflowWrap: "anywhere" }}>{b.name}</span>
                  <span className={`pill ${BRANCH_STATUS[b.status].pill}`}>{BRANCH_STATUS[b.status].label}</span>
                  {b.pr && <span className="l">בקשה #{b.pr.number}{b.pr.state === "MERGED" ? " (מוזגה)" : b.pr.state === "CLOSED" ? " (נסגרה)" : ""}</span>}
                  {b.url && <a className="l" style={{ marginInlineStart: "auto" }} href={b.url} target="_blank" rel="noreferrer">פתח ב-GitHub ↗</a>}
                </div>
                {b.status !== "default" && (
                  <div className="l">
                    {b.unique === 0 ? `אין בו שום דבר שלא נמצא ב-${data.defaultBranch}` : `${b.unique} commits שאינם ב-${data.defaultBranch}`}
                    {b.behind > 0 ? ` · ${data.defaultBranch} התקדם ב-${b.behind} מאז שנפתח` : ""}
                    {b.lastAt ? ` · פעילות אחרונה ${fmtDate(b.lastAt)}${b.lastBy ? ` (${b.lastBy})` : ""}` : ""}
                  </div>
                )}
                {b.lastMessage && b.status !== "default" && <div className="l">"{b.lastMessage}"</div>}
                <div className="l">איך הגיע לכאן<Info k="branch_origin" />: {b.origin}</div>
                <div className={`adv ${b.advice.tone}`}><b>{b.advice.title}.</b> {b.advice.detail}</div>
              </div>
            ))}
          </div>
          <p className="ob-sub" style={{ marginTop: 8 }}>מחיקה נעשית בגיט־האוסט, ורק אחרי שרואים שמה שבענף כבר לא נחוץ. ההיסטוריה של מה שמוזג נשארת גם אחרי המחיקה.</p>
        </>
      )}
    </>
  );
}

function Timeline({ items }: { items: TimelineItem[] }) {
  if (!items.length) return <p className="ob-sub">אין עדיין אירועים.</p>;
  return (
    <div className="panel">
      {items.map((t, i) => (
        <div className="pr-ev" key={i}>
          <div className="tm">{fmtDate(t.at)}</div>
          <div className={`ic ${t.tone ?? ""}`} />
          <div className="tx">
            {t.text}
            {t.tag && <span className="pill warning" style={{ marginInlineStart: 6 }}>{t.tag}</span>}
            {t.detail && <div className="l" style={{ marginTop: 2 }}>{t.detail}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

export function PullRequestDetailScreen({ repoId, number, tab, nav }: { repoId: string; number: number; tab: Tab; nav: (h: string) => void }) {
  // Something already fetched for this request paints immediately; the refresh happens behind it.
  const [d, setD] = useState<Detail | null>(() => cachedPullRequest(repoId, number));
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The header, the blockers and the next step arrive first; the heavy parts fill in behind them.
  const [q, setQ] = useState<PullRequestQuick | null>(null);
  useEffect(() => { let live = true; getPullRequestQuick(repoId, number).then((r) => { if (live) setQ(r); }).catch(() => {}); return () => { live = false; }; }, [repoId, number]);

  const load = useCallback(async (refresh?: boolean) => {
    setBusy(true);
    try { setD(await getPullRequest(repoId, number, refresh)); setErr(null); } catch (e) { setErr(String(e)); } finally { setBusy(false); }
  }, [repoId, number]);
  useEffect(() => { void load(); }, [load]);

  const go = (t: Tab) => nav(`#/pull-requests/${repoId}/${number}${t === "overview" ? "" : `/${t}`}`);

  // What the one chat knows about this screen (above the early returns — a hook).
  const h = d ?? q;
  useClaudeContext(h ? {
    screen: "pull_request",
    topic: { kind: "pr", id: `${repoId}/${number}`, title: `בקשת מיזוג #${number} · ${h.pr.repo.name}` },
    facts: {
      "כותרת": h.pr.title, "מענף": h.pr.headBranch, "לענף": h.pr.baseBranch, "מצב": h.pr.state === "open" ? (h.pr.draft ? "פתוחה (טיוטה)" : "פתוחה") : h.pr.state === "merged" ? "מוזגה" : "נסגרה",
      "סקירה": h.pr.review === "approved" ? "מאושרת" : h.pr.review === "changes_requested" ? "התבקשו תיקונים" : "אין עדיין",
      "בדיקות": h.pr.checks === "passing" ? "עברו" : h.pr.checks === "failing" ? "נכשלו" : h.pr.checks === "running" ? "רצות" : "אין",
      "התנגשות": h.pr.conflicts ? "יש" : "אין", "ממתינה": `${Math.round(h.pr.waitingHours)} שעות`,
      ...(d?.conflict?.files.length ? {
        [d.conflict.exact ? "הקבצים בהתנגשות" : "קבצים חשודים בהתנגשות"]:
          d.conflict.files.map((f) => `${f.path} · הענף +${f.ours?.additions ?? 0} −${f.ours?.deletions ?? 0} · היעד +${f.theirs?.additions ?? 0} −${f.theirs?.deletions ?? 0}`),
      } : {}),
      ...(d?.freshness ? { "מאחורי הבסיס": `${d.freshness.behind} קומיטים, ${d.freshness.sharedFiles} קבצים שגם הבקשה הזו משנה` } : {}),
      "מה חוסם": h.blockers.filter((b) => b.ok === false).map((b) => `${b.title}: ${b.detail}`),
      "הצעד הבא": `${h.nextStep.title} — ${h.nextStep.detail}`, nextStep: `${h.nextStep.title} — ${h.nextStep.detail}`,
      status: h.pr.state, blocker: h.blockers.find((b) => b.ok === false)?.title ?? null,
    },
    suggestions: ["למה הבקשה לא עדכנית?", "אפשר למזג עכשיו?", "מה ההבדל בין ענף פרויקט לענף משימה?"],
  } : null);

  if (err) return <><button className="btn btn-secondary btn-sm" onClick={() => nav("#/pull-requests")}>› חזרה לרשימה</button><div className="ob-note crit" style={{ marginTop: 12 }}>{err}</div></>;
  const head = d ?? q;
  if (!head) return <><button className="btn btn-secondary btn-sm" onClick={() => nav("#/pull-requests")}>› חזרה לרשימה</button><p className="ob-sub" style={{ marginTop: 12 }}>טוען את הבקשה…</p></>;

  const { pr, nextStep, blockers } = head;
  // A deletion is the part of a change a person most wants to have seen before approving.
  const deletedCount = (d?.groups ?? []).reduce((n, g) => n + g.files.filter((x) => x.status === "D").length, 0);
  const loading = (what: string) => <p className="ob-sub"><span className="spinner" style={{ width: 13, height: 13, marginInlineEnd: 8, verticalAlign: "middle" }} />טוען {what} מהגיט־האוסט…</p>;

  return (
    <div className="pr-screen">
      <div className="pr-bc">
        <button className="btn btn-secondary btn-sm" onClick={() => nav("#/pull-requests")}>› חזרה לרשימה</button>
        <span>בקשות מיזוג</span>›<span>{pr.client.name ?? "ללא לקוח"}</span>›<span>{pr.repo.name}</span>›<b>#{pr.number}</b>
        <button className="btn btn-secondary btn-sm" style={{ marginInlineStart: "auto" }} disabled={busy} onClick={() => void load(true)}>{busy ? "מסנכרן…" : "↻ סנכרן"}</button>
      </div>

      <div className="panel pr-head">
        <div className="top">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="h1 br">{pr.headBranch}<PrNumber n={pr.number} /></div>
            <div className="l">פתח {pr.author} · {waited(pr.waitingHours)} · אל <span className="ob-code">{pr.baseBranch}</span></div>
          </div>
          <div className="flags">
            {pr.state === "merged" && <span className="pill healthy">מוזגה</span>}
            {pr.state === "closed" && <span className="pill inactive">נסגרה בלי מיזוג</span>}
            {pr.draft && pr.state === "open" && <span className="pill inactive">טיוטה</span>}
            {pr.state === "open" && pr.conflicts && <span className="pill critical">התנגשות</span>}
            {pr.state === "open" && !pr.conflicts && pr.mergeable && <span className="pill healthy">אין התנגשות</span>}
          </div>
        </div>
        <div className="ob-actions">
          <a className="btn btn-primary btn-sm" href={pr.url} target="_blank" rel="noreferrer">פתח ב-GitHub ↗</a>
        </div>
      </div>

      <div className="pr-tabs">
        {TABS.map((t) => (
          <button key={t.key} type="button" className={`pr-tab${tab === t.key ? " on" : ""}`} onClick={() => go(t.key)}>
            {t.label}{t.key === "files" && d?.fileCount ? ` · ${d.fileCount}` : pr.changedFiles && t.key === "files" ? ` · ${pr.changedFiles}` : ""}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <>
          {/* The review flow below says what to do when only the approval is missing, so the next step would repeat it. */}
          {nextStep.action !== "request_review" && (
            <div className={`pr-next ${nextStep.action === "merge" ? "ok" : ""}`}>
              <div className="t">הצעד הבא</div>
              <div className="s">{nextStep.title}</div>
              <div className="d">{nextStep.detail}</div>
            </div>
          )}
          {pr.state === "open" && (pr.draft
            ? <div className="panel rv" style={{ marginBottom: 12 }}><CardTitle info="pr_review">סקירה ואישור</CardTitle><p className="ob-sub">כל עוד הבקשה מסומנת כטיוטה אין מה לסקור: סמנו אותה מוכנה לסקירה בגיט־האוסט, והתהליך ייפתח כאן.</p></div>
            : <ReviewFlow repoId={repoId} number={number} base={pr.baseBranch} blockers={blockers}
                steps={[
                  { key: "files", title: "עברתי על רשימת הקבצים", detail: `${d?.fileCount ?? pr.changedFiles} קבצים${d?.topics.length ? ` · ${d.topics.length} נושאים` : ""}`, go: () => go("files"), goText: "פתח את הרשימה" },
                  ...(deletedCount > 0 ? [{ key: "deleted", title: "ראיתי מה נמחק", detail: `${deletedCount} קבצים נמחקו בבקשה`, go: () => go("files"), goText: "פתח את הרשימה" }] : []),
                ]}
                onFiles={() => go("files")} onDone={() => void load(true)} />)}
          <div className="dash">
            <div style={{ minWidth: 0 }}>
              {blockers.length > 0 && <div className="panel" style={{ marginBottom: 12 }}>
                <CardTitle info="pr_blockers">מה חוסם מיזוג</CardTitle>
                <p className="ob-sub" style={{ marginBottom: 4 }}>המיזוג נפתח רק כשאין שורה אדומה.</p>
                {blockers.map((b) => <BlockerRow key={b.key} b={b} />)}
              </div>}
              {pr.state === "open" && pr.conflicts && <ConflictPanel conflict={d?.conflict ?? null} loading={!d || (busy && !d.conflict?.files.length)} url={pr.url} base={pr.baseBranch} />}
              {!d
                ? <div className="panel">{loading("את מפת הקוד")}</div>
                : (
                  <div className="pr-maprow">
                    <div className="map">
                      {d.codeMap ? <CodeMapPanel map={d.codeMap} /> : <div className="ob-note warn">{d.codeMapProblem ?? "אין מידע על מיקום הענף."}</div>}
                    </div>
                    {d.topics.length > 0 && (
                      <div className="panel pr-topics">
                        <CardTitle info="pr_branch_topics">על מה הענף</CardTitle>
                        <TopicRows topics={d.topics} />
                      </div>
                    )}
                  </div>
                )}
            </div>
            <div className="rail">
              <div className="panel">
                <CardTitle info="pr_facts">עובדות</CardTitle>
                <div className="ob-kv">
                  <div><div className="l">commits<Info k="commits" /></div><div className="v">{d?.freshness?.ahead ?? "—"}</div></div>
                  <div><div className="l">קבצים<Info k="pr_file_count" /></div><div className="v">{d?.fileCount ?? pr.changedFiles}</div></div>
                  <div><div className="l">היעד התקדם<Info k="base_advanced" /></div><div className="v">{d?.freshness ? `${d.freshness.behind}` : "—"}</div></div>
                  <div><div className="l">קבצים משותפים<Info k="shared_files" /></div><div className="v" style={{ color: d?.freshness?.sharedFiles ? "var(--status-warning)" : undefined }}>{d?.freshness?.sharedFiles ?? "—"}</div></div>
                </div>
              </div>
              <div className="panel">
                <CardTitle info="pr_people">אנשים</CardTitle>
                <div className="pr-rl"><span className="l">פתח</span><span>{pr.author}</span></div>
                <div className="pr-rl"><span className="l">סקירה<Info k="pr_review" /></span><span>{pr.review === "approved" ? "אושר" : pr.review === "changes_requested" ? "התבקשו שינויים" : "אין אישור"}</span></div>
                <div className="pr-rl"><span className="l">עודכן</span><span>{fmtDate(pr.updatedAt)}</span></div>
              </div>
            </div>
          </div>
        </>
      )}

      {tab === "files" && (d ? <Files groups={d.groups} count={d.fileCount} url={pr.url} repoId={repoId} number={number} /> : <div className="panel">{loading("את רשימת הקבצים")}</div>)}
      {tab === "timeline" && (d ? <Timeline items={d.timeline} /> : <div className="panel">{loading("את היומן")}</div>)}
      {tab === "branches" && <Branches repoId={repoId} />}
    </div>
  );
}
