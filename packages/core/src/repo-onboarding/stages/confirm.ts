import { registerStage } from "../state-machine.ts";
import type { StageOutcome } from "../types.ts";
import type { Discovery, DiscoveryQuestion, DiscoveryResult } from "./discovery.ts";

/**
 * Stage 4 — Confirm. The second human gate: answer what code can't tell,
 * correct what discovery got wrong. No AI call. Zero questions → Skipped
 * without a click. Unanswered questions are recorded as UNKNOWN, never
 * filled in.
 */
export type ConfirmAnswer = { id: string; answer_he: string; status: "answered" | "unknown" };
export type ConfirmResult = {
  questions: DiscoveryQuestion[];
  digest: { purpose: string; components: number; integrations: number; constraints: number; unknowns: string[]; coverage: Discovery["coverage"] };
  answers?: ConfirmAnswer[];
  corrections?: string;
  answeredAt?: string;
};

function digestOf(d: Discovery): ConfirmResult["digest"] {
  return { purpose: d.purpose, components: d.components?.length ?? 0, integrations: d.integrations?.length ?? 0, constraints: d.constraints?.length ?? 0, unknowns: d.unknowns ?? [], coverage: d.coverage ?? [] };
}

registerStage("confirm", async (ctx): Promise<StageOutcome> => {
  const disc = ctx.priorResults.discovery as DiscoveryResult | undefined;
  if (!disc?.discovery) return { status: "Failed", errors: ["discovery did not complete"] };
  const questions = disc.discovery.questions ?? [];

  if (ctx.resumeInput !== undefined) {
    const input = ctx.resumeInput as { answers?: unknown; corrections?: unknown };
    const given = Array.isArray(input.answers) ? (input.answers as { id?: unknown; answer_he?: unknown }[]) : [];
    const answers: ConfirmAnswer[] = questions.map((q) => {
      const a = given.find((x) => x.id === q.id);
      const text = typeof a?.answer_he === "string" ? a.answer_he.trim() : "";
      return { id: q.id, answer_he: text, status: text ? "answered" : "unknown" };
    });
    const result: ConfirmResult = {
      questions, digest: digestOf(disc.discovery), answers,
      corrections: typeof input.corrections === "string" && input.corrections.trim() ? input.corrections.trim() : undefined,
      answeredAt: new Date().toISOString(),
    };
    const unknown = answers.filter((a) => a.status === "unknown").length;
    return { status: "Completed", warnings: unknown ? [`${unknown} שאלות נשארו ללא מענה ונרשמו כ-UNKNOWN`] : [], result };
  }

  if (questions.length === 0) {
    return { status: "Skipped", result: { questions: [], digest: digestOf(disc.discovery), answers: [], answeredAt: new Date().toISOString() } satisfies ConfirmResult };
  }
  return { status: "WaitingForUser", result: { questions, digest: digestOf(disc.discovery) } satisfies ConfirmResult };
}, (waiting) => ({ answers: (waiting as ConfirmResult).questions.map((q) => ({ id: q.id, answer_he: "" })), corrections: "" }));
