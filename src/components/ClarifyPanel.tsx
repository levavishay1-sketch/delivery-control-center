"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { pollUntilStatusLeaves } from "@/lib/pollStatus";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/FormField";

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
    <div className="flex flex-col gap-3 rounded-card border border-status-warning/30 bg-status-warning-bg p-3">
      <p className="text-xs font-medium text-status-warning">
        Awaiting clarification — {outstanding.length} question{outstanding.length === 1 ? "" : "s"} outstanding
      </p>

      {answered.length > 0 && (
        <ul className="flex flex-col gap-1 text-xs text-neutral-600 dark:text-neutral-300">
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
          <Textarea
            value={drafts[q.id] ?? ""}
            onChange={(e) => setDrafts((d) => ({ ...d, [q.id]: e.target.value }))}
            rows={2}
            placeholder="Your answer"
          />
          <Button
            variant="primary"
            size="sm"
            onClick={() => submitAnswer(q.id)}
            disabled={pendingId !== null || !(drafts[q.id] ?? "").trim()}
            className="self-start"
          >
            {pendingId === q.id ? "Submitting…" : "Answer"}
          </Button>
        </div>
      ))}

      {error && <p className="text-xs text-status-critical">{error}</p>}
    </div>
  );
}
