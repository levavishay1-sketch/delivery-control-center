"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { pollUntilStatusLeaves } from "@/lib/pollStatus";

export interface ClarifyQuestionItem {
  id: string;
  question: string;
  answer: string | null;
  answeredByName: string | null;
}

export function ClarifyPanel({ stageId, questions }: { stageId: string; questions: ClarifyQuestionItem[] }) {
  const router = useRouter();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const outstanding = questions.filter((q) => q.answer === null);
  const answered = questions.filter((q) => q.answer !== null);

  async function submitAnswer(questionId: string) {
    const answer = (drafts[questionId] ?? "").trim();
    if (!answer) return;

    setPendingId(questionId);
    setError(null);
    const res = await fetch(`/api/clarify-questions/${questionId}/answer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answer }),
    });
    if (!res.ok) {
      setPendingId(null);
      setError((await res.json()).error ?? "Failed to submit answer");
      return;
    }

    const { resumedDrafting } = (await res.json()) as { resumedDrafting: boolean };
    if (resumedDrafting) {
      await pollUntilStatusLeaves(`/api/stages/${stageId}`, "AI_DRAFTING");
    }
    setPendingId(null);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3 rounded border border-amber-500/30 bg-amber-500/5 p-3">
      <p className="text-xs font-medium text-amber-600 dark:text-amber-400">
        Awaiting clarification — {outstanding.length} question{outstanding.length === 1 ? "" : "s"} outstanding
      </p>

      {answered.length > 0 && (
        <ul className="flex flex-col gap-1 text-xs opacity-70">
          {answered.map((q) => (
            <li key={q.id}>
              <span className="font-medium">Q: {q.question}</span>
              <br />
              A: {q.answer} {q.answeredByName ? `— ${q.answeredByName}` : ""}
            </li>
          ))}
        </ul>
      )}

      {outstanding.map((q) => (
        <div key={q.id} className="flex flex-col gap-1">
          <p className="text-sm font-medium">{q.question}</p>
          <textarea
            value={drafts[q.id] ?? ""}
            onChange={(e) => setDrafts((d) => ({ ...d, [q.id]: e.target.value }))}
            rows={2}
            placeholder="Your answer"
            className="rounded border border-black/15 dark:border-white/20 bg-transparent px-2 py-1 text-sm"
          />
          <button
            onClick={() => submitAnswer(q.id)}
            disabled={pendingId !== null || !(drafts[q.id] ?? "").trim()}
            className="self-start rounded bg-foreground px-3 py-1.5 text-sm font-medium text-background disabled:opacity-50"
          >
            {pendingId === q.id ? "Submitting…" : "Answer"}
          </button>
        </div>
      ))}

      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
