import { PageHead } from "../ui.tsx";

export function Stub({ title, note }: { title: string; note: string }) {
  return (
    <>
      <PageHead title={title} />
      <div className="panel"><p style={{ color: "var(--ink-500)" }}>{note}</p></div>
    </>
  );
}
