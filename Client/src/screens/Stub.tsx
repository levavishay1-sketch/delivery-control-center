import { PageHead } from "../ui.tsx";

export function Stub({ title, note }: { title: string; note: string }) {
  return (
    <>
      {/* a placeholder screen: its own note says what is missing, there is nothing to explain yet */}
      <PageHead title={title} info={null} />
      <div className="panel"><p style={{ color: "var(--ink-500)" }}>{note}</p></div>
    </>
  );
}
