import { useCallback, useEffect, useState } from "react";
import { getPullRequestConflict, resolvePullRequestConflict, type ConflictContent, type ConflictFileContent } from "../api.ts";
import { CardTitle } from "../ui.tsx";
import { Info } from "../claude/Info.tsx";
import { errText } from "./onboarding/labels.ts";

/**
 * Deciding a conflict, in DCC (`openspec/changes/pull-request-center`).
 *
 * GitHub's own web editor refuses this conflict — checked against this
 * repository's request #21: "These conflicts are too complex to resolve in
 * the web editor. Use the command line." So this screen is what a person has
 * instead of a terminal: the two versions side by side, a choice per place,
 * and one merge commit pushed to the request's branch in their name.
 *
 * Nothing here decides for them, and nothing is written until they press the
 * last button, which says exactly what it will do.
 */

type Choice = "ours" | "theirs" | "both";

const joinChoice = (c: Choice, ours: string, theirs: string) =>
  c === "ours" ? ours : c === "theirs" ? theirs : [ours, theirs].filter((s) => s.length).join("\n");

/** The file as it will be saved, from what was decided in each place. */
function compose(file: ConflictFileContent, choices: (Choice | null)[]): string {
  let i = -1;
  return file.segments.map((s) => {
    if (s.kind === "text") return s.text;
    i += 1;
    const c = choices[i];
    return c ? joinChoice(c, s.ours, s.theirs) : "";
  }).join("\n");
}

function Side({ title, tone, text }: { title: string; tone: "ours" | "theirs"; text: string }) {
  return (
    <div className="cf-side">
      <div className={`h ${tone}`}>{title}</div>
      <pre dir="ltr">{text || "(שורות ריקות)"}</pre>
    </div>
  );
}

function FileEditor({ file, choices, manual, onChoose, onManual }: {
  file: ConflictFileContent;
  choices: (Choice | null)[];
  manual: string | null;
  onChoose: (i: number, c: Choice) => void;
  onManual: (text: string | null) => void;
}) {
  if (!file.resolvable) {
    return <div className="ob-note warn" style={{ marginTop: 10 }}>{file.why ?? "את הקונפליקט בקובץ הזה אי אפשר להכריע כאן."} הכריעו אותו מהטרמינל, בעותק שלכם.</div>;
  }
  const places = file.segments.filter((s) => s.kind === "conflict");
  return (
    <>
      {manual === null && places.map((s, i) => {
        if (s.kind !== "conflict") return null;
        const c = choices[i] ?? null;
        return (
          <div className="cf-place" key={i}>
            <div className="cf-num">מקום {i + 1} מתוך {places.length}{c ? " · הוכרע" : ""}</div>
            <div className="cf-sides">
              <Side title="הענף שלכם" tone="ours" text={s.ours} />
              <Side title="מה שנוסף ביעד" tone="theirs" text={s.theirs} />
            </div>
            <div className="cf-acts">
              <span className="ob-sub">מה נשאר?</span>
              <button type="button" className={`chip${c === "ours" ? " on" : ""}`} onClick={() => onChoose(i, "ours")}>שלי</button>
              <button type="button" className={`chip${c === "theirs" ? " on" : ""}`} onClick={() => onChoose(i, "theirs")}>של היעד</button>
              <button type="button" className={`chip${c === "both" ? " on" : ""}`} onClick={() => onChoose(i, "both")}>שניהם, בזה אחר זה</button>
            </div>
          </div>
        );
      })}
      {manual !== null && (
        <div className="cf-place">
          <div className="cf-num">עריכה ידנית של כל הקובץ</div>
          <textarea className="cf-manual" dir="ltr" spellCheck={false} value={manual} onChange={(e) => onManual(e.target.value)} rows={18} />
          <p className="ob-sub" style={{ marginTop: 6 }}>זה מה שיישמר בקובץ, בדיוק כפי שכתוב כאן.</p>
        </div>
      )}
      <div className="cf-acts" style={{ marginTop: 8 }}>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => onManual(manual === null ? compose(file, choices) : null)}>
          {manual === null ? "ערוך את הקובץ ידנית" : "חזרה לבחירה בין הצדדים"}
        </button>
      </div>
    </>
  );
}

export function PullRequestConflictScreen({ repoId, number, back }: { repoId: string; number: number; back: () => void }) {
  const [d, setD] = useState<ConflictContent | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [choices, setChoices] = useState<Record<string, (Choice | null)[]>>({});
  const [manual, setManual] = useState<Record<string, string | null>>({});

  const load = useCallback(async () => {
    setErr(null);
    try {
      const r = await getPullRequestConflict(repoId, number);
      setD(r);
      setOpen(r.files.find((f) => f.resolvable)?.path ?? r.files[0]?.path ?? null);
      setChoices(Object.fromEntries(r.files.map((f) => [f.path, Array.from({ length: f.conflicts }, () => null)])));
      setManual(Object.fromEntries(r.files.map((f) => [f.path, null])));
    } catch (e) { setErr(errText(e)); }
  }, [repoId, number]);
  useEffect(() => { void load(); }, [load]);

  const settled = (f: ConflictFileContent) => {
    const m = manual[f.path];
    if (m !== null && m !== undefined) return m.trim().length > 0;
    return f.resolvable && (choices[f.path] ?? []).every((c) => c !== null);
  };
  const files = d?.files ?? [];
  const blocked = files.filter((f) => !f.resolvable);
  const left = files.filter((f) => f.resolvable && !settled(f)).length;
  const ready = !!d && files.length > 0 && blocked.length === 0 && left === 0;

  const save = async () => {
    if (!d || !ready) return;
    setBusy(true); setErr(null);
    try {
      const payload = files.map((f) => ({ path: f.path, content: manual[f.path] ?? compose(f, choices[f.path] ?? []) }));
      const r = await resolvePullRequestConflict(repoId, number, payload);
      setDone(`נוצר קומיט מיזוג ${r.commitSha} על ${r.branch} ונדחף. הקונפליקט נפתר ב-${r.files === 1 ? "קובץ אחד" : `${r.files} קבצים`}.`);
    } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };

  const file = files.find((f) => f.path === open) ?? null;

  return (
    <div className="cf">
      <div className="pr-bc" style={{ marginBottom: 12 }}>
        <button className="btn btn-secondary btn-sm" onClick={back}>› חזרה לבקשה</button>
        <span>פתרון קונפליקט</span>{d && <>›<span className="ob-code">{d.head}</span>›<b>מול {d.base}</b></>}
      </div>

      {err && <div className="ob-note crit" style={{ marginBottom: 12 }}>{err}</div>}
      {done && (
        <div className="ob-note ok" style={{ marginBottom: 12 }}>
          {done} <button className="btn btn-secondary btn-sm" style={{ marginInlineStart: 8 }} onClick={back}>חזרה לבקשה</button>
        </div>
      )}

      {!d && !err && <div className="panel"><p className="ob-sub">מחשב את המיזוג ובודק איפה שני הצדדים נוגעים באותן שורות…</p></div>}

      {d && !done && (
        <>
          {d.needsCommandLine && (
            <div className="ob-note warn" style={{ marginBottom: 12 }}>
              את הקונפליקט הזה אי אפשר להכריע כאן — הוא לא על שורות שנכתבו אחרת. זה בדיוק המקרה שבו גם הגיט־האוסט שולח לטרמינל. הכריעו בעותק שלכם ואז דחפו.
            </div>
          )}
          <div className="dash">
            <div style={{ minWidth: 0 }}>
              {file && (
                <div className="panel">
                  <CardTitle info="pr_conflict_files"><bdi dir="ltr">{file.path}</bdi></CardTitle>
                  <p className="ob-sub" style={{ marginBottom: 8 }}>
                    {file.resolvable
                      ? `בקובץ הזה ${file.conflicts === 1 ? "מקום אחד" : `${file.conflicts} מקומות`} ששני הצדדים כתבו בהם אחרת. בכל מקום בחרו מה נשאר.`
                      : "הקובץ הזה לא ניתן להכרעה מכאן."}
                  </p>
                  <FileEditor
                    file={file}
                    choices={choices[file.path] ?? []}
                    manual={manual[file.path] ?? null}
                    onChoose={(i, c) => setChoices((prev) => {
                      const cur = [...(prev[file.path] ?? [])];
                      cur[i] = c;
                      return { ...prev, [file.path]: cur };
                    })}
                    onManual={(text) => setManual((prev) => ({ ...prev, [file.path]: text }))}
                  />
                </div>
              )}
            </div>

            <aside className="rail">
              <div className="panel">
                <CardTitle info="pr_conflict_files">הקבצים בקונפליקט</CardTitle>
                {files.map((f) => (
                  <div key={f.path} className={`pr-chk go${open === f.path ? " on" : ""}`} role="button" tabIndex={0}
                    onClick={() => setOpen(f.path)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(f.path); } }}>
                    <span className={`ic ${!f.resolvable ? "na" : settled(f) ? "yes" : "no"}`}>{!f.resolvable ? "–" : settled(f) ? "✓" : "✕"}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="tt ob-code" style={{ overflowWrap: "anywhere" }}>{f.path}</div>
                      <div className="dd">{!f.resolvable ? "לא ניתן להכרעה כאן" : settled(f) ? "הוכרע" : `${f.conflicts === 1 ? "מקום אחד" : `${f.conflicts} מקומות`} להכריע`}</div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="panel">
                <CardTitle info="pr_conflict_save">שמירת ההכרעה</CardTitle>
                <p className="ob-sub">
                  ייווצר קומיט מיזוג אחד על <span className="ob-code">{d.head}</span>, בשמכם, והוא יידחף לגיט־האוסט. הבקשה תפסיק להיות בקונפליקט.
                  המיזוג ל-<span className="ob-code">{d.base}</span> עצמו לא קורה כאן — אותו תאשרו בנפרד.
                </p>
                <div className="ob-actions" style={{ marginTop: 10 }}>
                  <button className="btn btn-primary btn-sm" disabled={!ready || busy} onClick={() => void save()}>
                    {busy ? "שומר ודוחף…" : "שמור ודחוף את ההכרעה"}
                  </button>
                  <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => void load()}>טען מחדש</button>
                </div>
                {!ready && !busy && (
                  <p className="ob-sub" style={{ marginTop: 8 }}>
                    {blocked.length ? `${blocked.length === 1 ? "קובץ אחד" : `${blocked.length} קבצים`} לא ניתנים להכרעה מכאן, ולכן אי אפשר לשמור.` : `נשארו ${left === 1 ? "קובץ אחד" : `${left} קבצים`} להכריע.`}
                  </p>
                )}
              </div>
            </aside>
          </div>
        </>
      )}
    </div>
  );
}
