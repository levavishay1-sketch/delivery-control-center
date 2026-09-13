import type { TimelineSummary } from "../summarise.ts";
export type BriefModel = {
    key: string | null;
    title: string;
    phase: string;
    type: string;
    linkedAdoId: number | null;
    startedWithOpenBlocker: boolean;
    gaps: {
        description: string;
        blocking: boolean;
        verified: boolean;
        confidence: number;
    }[];
    openBlockers: {
        questionType: string;
        question: string;
    }[];
    answeredBlockers: {
        question: string;
        answer: string;
    }[];
    tasks: {
        seq: number;
        intent: string;
        state: string;
    }[];
    lastReview: {
        verdict: string;
        findings: {
            file: string;
            severity: string;
            note: string;
        }[];
    } | null;
    recentTimeline: {
        occurredAt: Date;
        source: string;
        type: string;
        payload: unknown;
    }[];
};
/**
 * The Context Brief as Markdown — what SessionStart prints to stdout so
 * it becomes the next session's context. Compact by design: a few
 * thousand tokens, not the whole timeline.
 */
export declare function renderBrief(m: BriefModel, narrative: TimelineSummary): string;
//# sourceMappingURL=render.d.ts.map