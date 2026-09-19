import { registerStage } from "../state-machine.ts";
import type { StageOutcome } from "../types.ts";
import type { Discovery, DiscoveryQuestion, DiscoveryResult } from "./discovery.ts";

/**
 * Stage 4 — Confirm. The second human gate: answer what code can't tell,
 * correct what discovery got wrong. No AI call. Zero questions → Skipped
 * without a click. Unanswered questions are recorded as UNKNOWN, never
 * filled in.
 *
 * "Nobody knows" and "nobody was asked" are different facts and are kept
 * apart. When the automation policy resolves this gate, no person ever
 * saw the questions, so the answers are `not_asked` — otherwise a later
 * stage writes "we asked the team and the answer is genuinely unknown"
 * into the repository, together with an instruction not to investigate
 * it again. That is a false statement, and a durable one.
 */
export type ConfirmAnswer = { id: string; answer_he: string; status: "answered" | "unknown" | "not_asked" };
export type ConfirmResult = {
  questions: DiscoveryQuestion[];
  digest: { purpose: string; components: number; integrations: number; constraints: number; unknowns: string[]; coverage: Discovery["coverage"] };
  answers?: ConfirmAnswer[];
  corrections?: string;
  answeredAt?: string;
  /** Whether a person answered this gate or the automation policy
   *  resolved it. Read by `plan`/`generate` to keep an unasked question
   *  from being written up as a verified team answer. */
  resolvedBy?: "person" | "automation";
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
    const byAutomation = ctx.resumeSource === "automation";
    const answers: ConfirmAnswer[] = questions.map((q) => {
      const a = given.find((x) => x.id === q.id);
      const text = typeof a?.answer_he === "string" ? a.answer_he.trim() : "";
      return { id: q.id, answer_he: text, status: text ? "answered" : byAutomation ? "not_asked" : "unknown" };
    });
    const result: ConfirmResult = {
      questions, digest: digestOf(disc.discovery), answers,
      corrections: typeof input.corrections === "string" && input.corrections.trim() ? input.corrections.trim() : undefined,
      answeredAt: new Date().toISOString(),
      resolvedBy: byAutomation ? "automation" : "person",
    };
    const notAsked = answers.filter((a) => a.status === "not_asked").length;
    const unknown = answers.filter((a) => a.status === "unknown").length;
    const warnings: string[] = [];
    if (notAsked) warnings.push(`${notAsked} שאלות לא הוצגו לאף אדם — השער אושר אוטומטית. הן נרשמו כ"לא נשאל", ולא ייכתבו כתשובות מאומתות.`);
    if (unknown) warnings.push(`${unknown} שאלות נשארו ללא מענה ונרשמו כ-UNKNOWN`);
    return { status: "Completed", warnings, result };
  }

  if (questions.length === 0) {
    return { status: "Skipped", result: { questions: [], digest: digestOf(disc.discovery), answers: [], answeredAt: new Date().toISOString() } satisfies ConfirmResult };
  }
  return { status: "WaitingForUser", result: { questions, digest: digestOf(disc.discovery) } satisfies ConfirmResult };
}, (waiting) => ({ answers: (waiting as ConfirmResult).questions.map((q) => ({ id: q.id, answer_he: "" })), corrections: "" }));
