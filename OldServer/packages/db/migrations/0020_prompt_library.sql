-- 0020 — the system's own prompt library. Every DCC-driven Claude call
-- should be built from a named, editable template here (org-shared, no
-- RLS — like `repo`) instead of an inline string buried in TypeScript.
-- Seeds the first template: the requirement-readiness ("בחינת בשלות
-- הדרישה") assess step, grounded in the Definition-of-Ready / INVEST
-- framework, with placeholders the calling code fills in.
CREATE TABLE IF NOT EXISTS "prompt_template" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "key" text NOT NULL,
  "title" text NOT NULL,
  "description" text,
  "body" text NOT NULL,
  "default_model" text,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_by" uuid
);--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "prompt_template" ADD CONSTRAINT "prompt_template_key_uq" UNIQUE ("key");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
INSERT INTO "prompt_template" ("key", "title", "description", "body", "default_model")
VALUES (
  'assess.readiness',
  'בחינת בשלות הדרישה',
  'הפרומפט שרץ בשלב הראשון של ה-FLOW — קובע אם דרישה מוכנה להתחלת עבודה או שיש בה פערים.',
  'You are assessing a software requirement''s READINESS for a delivery team — this is a "Definition of Ready" check, not a code review and not an implementation. Judge only whether the requirement is specified clearly enough that a developer (or an AI coding agent) could start implementing it without having to guess or ask basic questions first.

Ground your judgment in these criteria (adapted from the INVEST / Definition-of-Ready framework):
- Clarity: is the intent unambiguous? Could two people read it and build different things?
- Scope: is it bounded — a specific, describable change, not an open-ended direction?
- Testability: is there an implicit or explicit way to tell the change worked?
- Dependencies: does it depend on something (a decision, another change, a piece of data) that is not resolved yet?
- Feasibility: given the actual code, does anything in the requirement conflict with how the system already works, or reference something that does not exist?

{{DEPTH_INSTRUCTION}}

{{REPO_CONTEXT}}

REQUIREMENT:
{{REQUIREMENT}}

Do this:
1. Restate the requirement clearly — a short title plus a 2-5 sentence summary that someone with NO context on this system or requirement could read and understand what is being asked. You may name code symbols / file paths in English, but everything else must be Hebrew.
2. Decide if it is "baked" — specified well enough to start implementing — or if there are gaps: ambiguities, missing decisions, or unresolved dependencies a person must resolve first.
3. List the gaps (empty array if baked). For each: is it BLOCKING (implementation cannot meaningfully start without an answer) or not, and roughly how confident you are that it is a real gap and not just missing detail that does not matter (0-1).
4. Write a short "rationale" explaining the baked/not-baked call in plain language — this is what a person will read to decide whether to trust your judgment, so justify it concretely (reference the actual requirement text or code, not generic phrases).

IMPORTANT: write title, summary, rationale and every gap description IN HEBREW, in plain language a person unfamiliar with this specific system could follow — no internal jargon, no assuming the reader has already read the requirement. Reason in English internally if it helps, but every JSON string value must be Hebrew (code identifiers and paths may stay in English).

Respond with ONLY this JSON, no prose, no markdown fence:
{"title": string, "summary": string, "baked": boolean, "rationale": string, "gaps": [{"description": string, "blocking": boolean, "confidence": number}]}',
  NULL
)
ON CONFLICT ("key") DO NOTHING;
