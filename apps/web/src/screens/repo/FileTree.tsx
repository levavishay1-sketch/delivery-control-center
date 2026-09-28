import { useEffect, useMemo, useState } from "react";
import { getOnboardingFile } from "../../api.ts";
import { Info } from "../../claude/Info.tsx";
import { CodeLine } from "../../components/Code.tsx";
import { langOf } from "../../components/code.ts";
import { FileCompare, type FileVersionsData } from "../../components/FileCompare.tsx";
import { treeRows } from "./fileTree.ts";

/**
 * The files of a delivery as the repository will hold them: a tree, drawn the
 * way a terminal draws one (├── └── │), and the file you press opens beside it
 * — its content as it goes into the pull request, and, for a file the
 * repository already had, a comparison with the version it replaces.
 */

export function DeliveryTree({ files, repoName, repoId, runId }: { files: string[]; repoName: string; repoId: string; runId: string }) {
  const rows = useMemo(() => treeRows(files), [files]);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="rd-deliver">
      <div className="rd-tree" dir="ltr">
        <div className="t-root">{repoName || "Repository"}/</div>
        {rows.map((r) => "spacer" in r
          ? <div key={r.key} className="t-line"><span className="t-pre">{r.spacer}</span></div>
          : r.dir
            ? <div key={r.key} className="t-line"><span className="t-pre">{r.prefix}</span><span className="t-dir">{r.name}/</span></div>
            : <button key={r.key} type="button" className="t-line t-file" aria-pressed={open === r.path} onClick={() => setOpen(r.path)}><span className="t-pre">{r.prefix}</span>{r.name}</button>)}
      </div>
      <div className="rd-fileview">
        {open ? <FileView key={open} path={open} repoId={repoId} runId={runId} /> : <p className="ob-sub" style={{ margin: 0 }}>לחצו על קובץ בעץ כדי לראות כאן את התוכן שלו, כפי שייכנס ל-PR.</p>}
      </div>
    </div>
  );
}

/** One file as it will be delivered; a file the repository already had can be compared with the version it replaces. */
function FileView({ path, repoId, runId }: { path: string; repoId: string; runId: string }) {
  const [data, setData] = useState<FileVersionsData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [compare, setCompare] = useState(false);
  // Loaded once per file (the key remounts it): the screen refreshes every few seconds and must not refetch it.
  useEffect(() => { getOnboardingFile(repoId, runId, path).then(setData).catch((e) => setErr(String((e as Error).message ?? e))); }, [repoId, runId, path]);
  if (err) return <div className="ob-note crit">הקובץ לא נטען: {err}</div>;
  if (!data) return <p className="ob-sub" style={{ margin: 0 }}>טוען…</p>;
  const changed = data.before !== null;
  const lang = langOf(path);
  return (
    <div style={{ display: "grid", gap: 8, minWidth: 0 }}>
      <div className="rd-inline">
        <span className="ob-code" style={{ fontWeight: 650 }}>{path}</span>
        <span className={`rd-chip ${changed ? "human" : "ok"}`}>{changed ? "קובץ קיים שמשתנה" : "קובץ חדש"}</span>
        <Info k="deliver_file_content" />
        {changed && !data.binary && !data.tooLarge && <button type="button" className="ob-toggle" onClick={() => setCompare((v) => !v)}>{compare ? "הצג את התוכן" : "השווה לגרסה שבריפו"}</button>}
      </div>
      {data.binary ? <p className="ob-sub" style={{ margin: 0 }}>קובץ בינארי — אין תוכן להציג.</p>
        : data.tooLarge ? <p className="ob-sub" style={{ margin: 0 }}>הקובץ גדול מדי להצגה כאן.</p>
          : data.after === null ? <p className="ob-sub" style={{ margin: 0 }}>הקובץ לא נמצא בעותק.</p>
            : compare ? <FileCompare load={() => Promise.resolve(data)} />
              : (
                <pre className="rd-filebody" dir="ltr">
                  {data.after.replace(/\n$/, "").split("\n").map((line, i) => <div key={i}><span className="n">{i + 1}</span><CodeLine text={line} lang={lang} /></div>)}
                </pre>
              )}
    </div>
  );
}
