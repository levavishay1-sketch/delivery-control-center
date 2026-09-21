import { useCallback, useEffect, useMemo, useState } from "react";
import { getPullRequestConflict, resolvePullRequestConflict, verifyPullRequestConflict, type ConflictContent, type ConflictFileContent, type VerifyResult } from "../api.ts";
import { CardTitle } from "../ui.tsx";
import { CodeBlock, CodeEditor } from "../components/Code.tsx";
import { langOf } from "../components/code.ts";
import { Info } from "../claude/Info.tsx";
import { errText } from "./onboarding/labels.ts";

/**
 * Deciding a conflict, laid out the way an editor's merge view is
 * (`openspec/changes/pull-request-center`): the two files in full at the top,
 * each with its own conflicting stretches marked inside it, and the result
 * underneath. A person sees the conflict where it lives — in the file, with
 * the code around it — and not as a fragment lifted out of it.
 *
 * GitHub's web editor refuses this conflict outright ("too complex… use the
 * command line", checked against this repository's request #21), so this is
 * what a person has instead of a terminal. Nothing is written until the last
 * button, which says exactly what it will do.
 */

type Choice = "ours" | "theirs" | "both";
type Mark = { from: number; to: number; tone: "ours" | "theirs" };

const lines = (s: string) => s.split("\n");

/** Where each conflicting stretch sits inside one side's own file, found by matching its lines in order. */
function marksIn(file: string, pieces: string[], tone: "ours" | "theirs"): Mark[] {
  const all = lines(file);
  const out: Mark[] = [];
  let at = 0;
  for (const piece of pieces) {
    const want = lines(piece);
    if (!piece.length) { out.push({ from: Math.min(at, all.length - 1), to: Math.min(at, all.length - 1), tone }); continue; }
    let found = -1;
    for (let i = at; i + want.length <= all.length; i++) {
      if (want.every((w, k) => all[i + k] === w)) { found = i; break; }
    }
    if (found === -1) { out.push({ from: -1, to: -1, tone }); continue; }
    out.push({ from: found, to: found + want.length, tone });
    at = found + want.length;
  }
  return out;
}

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

function Pane({ lang, tone, file, marks, active, onMark, note }: {
  lang: string; tone: "ours" | "theirs"; file: string; marks: Mark[]; active: number; onMark: (i: number) => void; note: string;
}) {
  return (
    <div className="cf-pane">
      <div className={`h ${tone}`}>{note}</div>
      <CodeBlock text={file} lang={lang} marks={marks.filter((m) => m.from >= 0)} activeMark={active} onMark={onMark} />
    </div>
  );
}

function FileEditor({ file, choices, manual, approved, active, setActive, onChoose, onManual, onApprove }: {
  file: ConflictFileContent;
  choices: (Choice | null)[];
  manual: string | null;
  approved: boolean;
  active: number;
  setActive: (i: number) => void;
  onChoose: (i: number, c: Choice) => void;
  onManual: (text: string | null) => void;
  onApprove: () => void;
}) {
  const lang = langOf(file.path);
  const places = useMemo(() => file.segments.filter((s) => s.kind === "conflict") as { kind: "conflict"; ours: string; theirs: string }[], [file]);
  const ourMarks = useMemo(() => marksIn(file.oursFile, places.map((p) => p.ours), "ours"), [file, places]);
  const theirMarks = useMemo(() => marksIn(file.theirsFile, places.map((p) => p.theirs), "theirs"), [file, places]);
  const result = manual ?? compose(file, choices);

  if (!file.resolvable) {
    return <div className="ob-note warn" style={{ marginTop: 10 }}>{file.why ?? "את הקונפליקט בקובץ הזה אי אפשר להכריע כאן."} הכריעו אותו מהטרמינל, בעותק שלכם.</div>;
  }

  return (
    <>
      {manual === null ? (
        <>
          <div className="cf-panes">
            <Pane lang={lang} tone="ours" file={file.oursFile} marks={ourMarks} active={active} onMark={setActive} note="הענף שלכם" />
            <Pane lang={lang} tone="theirs" file={file.theirsFile} marks={theirMarks} active={active} onMark={setActive} note="מה שנוסף ביעד" />
          </div>

          <div className="cf-places">
            {places.map((p, i) => (
              <div className={`cf-place${i === active ? " on" : ""}`} key={i} onClick={() => setActive(i)}>
                <div className="cf-num">
                  קונפליקט {i + 1} מתוך {places.length}
                  {ourMarks[i] && ourMarks[i]!.from >= 0 ? ` · שורה ${ourMarks[i]!.from + 1} אצלכם` : ""}
                  {choices[i] ? " · הוכרע" : ""}
                </div>
                <div className="cf-acts">
                  <span className="ob-sub">מה נשאר?</span>
                  <button type="button" className={`chip${choices[i] === "ours" ? " on" : ""}`} onClick={() => onChoose(i, "ours")}>שלי</button>
                  <button type="button" className={`chip${choices[i] === "theirs" ? " on" : ""}`} onClick={() => onChoose(i, "theirs")}>של היעד</button>
                  <button type="button" className={`chip${choices[i] === "both" ? " on" : ""}`} onClick={() => onChoose(i, "both")}>שניהם, בזה אחר זה</button>
                </div>
              </div>
            ))}
          </div>

          <div className="cf-result">
            <div className="h">התוצאה — כך ייראה הקובץ אחרי השמירה<Info k="pr_conflict_result" /></div>
            <CodeBlock text={result} lang={lang} maxHeight={320} />
          </div>
        </>
      ) : (
        <div className="cf-result">
          <div className="h">עריכת הקובץ שלכם<Info k="pr_conflict_manual" />{approved && <span className="l">אושר</span>}</div>
          <p className="ob-sub" style={{ margin: "6px 0 8px" }}>
            זה הקובץ כפי שהוא בענף שלכם, פתוח לעריכה. ערכו אותו, והכניסו בעצמכם את מה שאתם רוצים לקחת מהיעד — הוא מוצג למעלה. מה שיישמר הוא בדיוק מה שכתוב כאן.
          </p>
          <CodeEditor value={manual} lang={lang} onChange={onManual} rows={22} />
        </div>
      )}

      <div className="cf-acts" style={{ marginTop: 10 }}>
        {manual === null
          ? <button type="button" className="btn btn-secondary btn-sm" onClick={() => onManual(file.oursFile)}>ערוך את הקובץ ידנית</button>
          : <>
              <button type="button" className="btn btn-primary btn-sm" disabled={approved} onClick={onApprove}>{approved ? "✓ העריכה אושרה" : "אשר עריכה"}</button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => onManual(null)}>בטל את העריכה וחזור לבחירה</button>
            </>}
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
  const [active, setActive] = useState(0);
  const [choices, setChoices] = useState<Record<string, (Choice | null)[]>>({});
  const [manual, setManual] = useState<Record<string, string | null>>({});
  const [approved, setApproved] = useState<Record<string, boolean>>({});
  const [check, setCheck] = useState<VerifyResult | null>(null);
  const [checking, setChecking] = useState(false);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const r = await getPullRequestConflict(repoId, number);
      setD(r);
      setOpen(r.files.find((f) => f.resolvable)?.path ?? r.files[0]?.path ?? null);
      setChoices(Object.fromEntries(r.files.map((f) => [f.path, Array.from({ length: f.conflicts }, () => null)])));
      setManual(Object.fromEntries(r.files.map((f) => [f.path, null])));
      setApproved({});
      setActive(0);
    } catch (e) { setErr(errText(e)); }
  }, [repoId, number]);
  useEffect(() => { void load(); }, [load]);

  // A file is settled when every place in it was decided, or when its own text was edited and approved.
  const settled = (f: ConflictFileContent) => {
    if (!f.resolvable) return false;
    if (manual[f.path] != null) return !!approved[f.path] && (manual[f.path] ?? "").trim().length > 0;
    return (choices[f.path] ?? []).every((c) => c !== null);
  };
  const files = d?.files ?? [];
  const blocked = files.filter((f) => !f.resolvable);
  const left = files.filter((f) => f.resolvable && !settled(f)).length;
  const ready = !!d && files.length > 0 && blocked.length === 0 && left === 0;

  const payloadOf = () => files.map((f) => ({ path: f.path, content: manual[f.path] ?? compose(f, choices[f.path] ?? []) }));

  const verify = async () => {
    if (!d || !ready) return;
    setChecking(true); setErr(null); setCheck(null);
    try { setCheck(await verifyPullRequestConflict(repoId, number, payloadOf())); }
    catch (e) { setErr(errText(e)); } finally { setChecking(false); }
  };

  const save = async () => {
    if (!d || !ready) return;
    setBusy(true); setErr(null);
    try {
      const payload = payloadOf();
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
                  <p className="ob-sub" style={{ marginBottom: 10 }}>
                    {file.resolvable
                      ? `שני הקבצים במלואם, ובתוכם מסומן ${file.conflicts === 1 ? "המקום" : "כל מקום"} ששני הצדדים כתבו בו אחרת. לחיצה על מקום מסומן קופצת אליו.`
                      : "הקובץ הזה לא ניתן להכרעה מכאן."}
                  </p>
                  <FileEditor
                    file={file}
                    choices={choices[file.path] ?? []}
                    manual={manual[file.path] ?? null}
                    approved={!!approved[file.path]}
                    active={active}
                    setActive={setActive}
                    onChoose={(i, c) => setChoices((prev) => {
                      const cur = [...(prev[file.path] ?? [])];
                      cur[i] = c;
                      return { ...prev, [file.path]: cur };
                    })}
                    // Editing always un-approves: what was approved is no longer what is written.
                    onManual={(text) => {
                      setManual((prev) => ({ ...prev, [file.path]: text }));
                      setApproved((prev) => ({ ...prev, [file.path]: false }));
                    }}
                    onApprove={() => setApproved((prev) => ({ ...prev, [file.path]: true }))}
                  />
                </div>
              )}
            </div>

            <aside className="rail">
              <div className="panel">
                <CardTitle info="pr_conflict_files">הקבצים בקונפליקט</CardTitle>
                {files.map((f) => (
                  <div key={f.path} className={`pr-chk go${open === f.path ? " on" : ""}`} role="button" tabIndex={0}
                    onClick={() => { setOpen(f.path); setActive(0); }}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(f.path); setActive(0); } }}>
                    <span className={`ic ${!f.resolvable ? "na" : settled(f) ? "yes" : "no"}`}>{!f.resolvable ? "–" : settled(f) ? "✓" : "✕"}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="tt ob-code" style={{ overflowWrap: "anywhere" }}>{f.path}</div>
                      <div className="dd">{!f.resolvable ? "לא ניתן להכרעה כאן" : settled(f) ? (manual[f.path] != null ? "נערך ואושר" : "הוכרע") : `${f.conflicts === 1 ? "מקום אחד" : `${f.conflicts} מקומות`} להכריע`}</div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="panel">
                <CardTitle info="pr_conflict_check">בדיקה שכלום לא נשבר</CardTitle>
                <p className="ob-sub">
                  DCC יריץ את הבדיקות של המאגר עצמו על התוצאה, בעותק מבודד, <b>לפני</b> שמשהו נדחף. זו אותה תשובה שהייתם מקבלים מהטרמינל.
                </p>
                <div className="ob-actions" style={{ marginTop: 10 }}>
                  <button className="btn btn-secondary btn-sm" disabled={!ready || checking || busy} onClick={() => void verify()}>
                    {checking ? "בודק…" : "בדוק את התוצאה"}
                  </button>
                </div>
                {checking && <p className="ob-sub" style={{ marginTop: 8 }}>מכין עותק ומריץ. זה לוקח כמה עשרות שניות.</p>}
                {check && !check.ran && <div className="ob-note warn" style={{ marginTop: 8 }}>{check.why}</div>}
                {check?.ran && (
                  <>
                    <div className={`ob-note ${check.checks.every((c) => c.ok) ? "ok" : "crit"}`} style={{ margin: "8px 0" }}>
                      {check.checks.every((c) => c.ok) ? "כל הבדיקות עברו על התוצאה." : "יש בדיקה שנכשלה על התוצאה. כדאי לתקן לפני שדוחפים."}
                    </div>
                    {check.checks.map((c) => (
                      <div className="pr-chk" key={c.name}>
                        <span className={`ic ${c.ok ? "yes" : "no"}`}>{c.ok ? "✓" : "✕"}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className="tt ob-code">{c.command}</div>
                          <div className="dd">{c.ok ? `עבר · ${Math.round(c.ms / 1000)} שניות` : "נכשל"}</div>
                          {!c.ok && <pre className="cf-out" dir="ltr">{c.output}</pre>}
                        </div>
                      </div>
                    ))}
                  </>
                )}
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
                {check?.ran && !check.checks.every((c) => c.ok) && ready && (
                  <p className="ob-sub" style={{ marginTop: 8 }}>בדיקה נכשלה על התוצאה. אפשר לשמור בכל זאת, אבל אז הענף יישאר שבור עד שיתוקן.</p>
                )}
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
