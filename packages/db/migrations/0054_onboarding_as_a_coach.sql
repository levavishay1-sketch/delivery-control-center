-- 0054 — repository onboarding as a coach (openspec/changes/repository-coach).
--
-- The four stages around one /init session are replaced by one fixed,
-- deterministic process whose result differs per repository: a diagnosis
-- (no model), the repository's own processes with an agent test per step, a
-- trial run that gives a baseline, a plan of component cards each carrying
-- its evidence, a build verified per component, delivery of only what was
-- approved — and a coach that keeps proposing from real sessions afterwards.
--
-- The run table is recreated for the new shape (a run's steps, profile,
-- processes, trials and components are rows of their own now); runs of the
-- previous design are dropped with it — they were finished, and their cost
-- stays in the ledger. `repo_ai_event` stays the one event stream.
DROP TABLE IF EXISTS "repository_onboarding_stage" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "repository_onboarding_run" CASCADE;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "repository_onboarding_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repo_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"kind" text DEFAULT 'onboarding' NOT NULL,
	"status" text DEFAULT 'Pending' NOT NULL,
	"current_step_key" text,
	"workspace_path" text,
	"default_branch" text,
	"baseline_sha" text,
	"branch_name" text,
	"automation" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"session" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"triggered_by" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "repository_onboarding_run" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "repository_onboarding_run" ADD CONSTRAINT "repository_onboarding_run_repo_id_repo_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repo"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_onboarding_run" ADD CONSTRAINT "repository_onboarding_run_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_onboarding_run" ADD CONSTRAINT "repository_onboarding_run_triggered_by_users_id_fk" FOREIGN KEY ("triggered_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_onboarding_run" ADD CONSTRAINT "repository_onboarding_run_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "repository_onboarding_run_repo_idx" ON "repository_onboarding_run" ("repo_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "repository_onboarding_run_live_uq" ON "repository_onboarding_run" USING btree ("repo_id") WHERE status in ('Pending','Running','WaitingForUser');--> statement-breakpoint
CREATE POLICY "repository_onboarding_run_tenant_isolation" ON "repository_onboarding_run" AS PERMISSIVE FOR ALL TO public USING (client_id = current_setting('app.current_client', true)::uuid) WITH CHECK (client_id = current_setting('app.current_client', true)::uuid);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "repository_onboarding_step" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"step_key" text NOT NULL,
	"step_order" integer NOT NULL,
	"status" text DEFAULT 'Pending' NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"result" jsonb,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "repository_onboarding_step_run_key_uq" UNIQUE("run_id","step_key")
);--> statement-breakpoint
ALTER TABLE "repository_onboarding_step" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "repository_onboarding_step" ADD CONSTRAINT "repository_onboarding_step_run_id_repository_onboarding_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."repository_onboarding_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_onboarding_step" ADD CONSTRAINT "repository_onboarding_step_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "repository_onboarding_step_run_order_idx" ON "repository_onboarding_step" ("run_id","step_order");--> statement-breakpoint
CREATE POLICY "repository_onboarding_step_tenant_isolation" ON "repository_onboarding_step" AS PERMISSIVE FOR ALL TO public USING (client_id = current_setting('app.current_client', true)::uuid) WITH CHECK (client_id = current_setting('app.current_client', true)::uuid);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "repo_profile" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repo_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"baseline_sha" text,
	"profile" jsonb NOT NULL,
	"corrections" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "repo_profile_run_uq" UNIQUE("run_id")
);--> statement-breakpoint
ALTER TABLE "repo_profile" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "repo_profile" ADD CONSTRAINT "repo_profile_repo_id_repo_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repo"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repo_profile" ADD CONSTRAINT "repo_profile_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repo_profile" ADD CONSTRAINT "repo_profile_run_id_repository_onboarding_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."repository_onboarding_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "repo_profile_repo_idx" ON "repo_profile" ("repo_id","created_at");--> statement-breakpoint
CREATE POLICY "repo_profile_tenant_isolation" ON "repo_profile" AS PERMISSIVE FOR ALL TO public USING (client_id = current_setting('app.current_client', true)::uuid) WITH CHECK (client_id = current_setting('app.current_client', true)::uuid);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "onboarding_process" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"key" text NOT NULL,
	"title" text NOT NULL,
	"source" text NOT NULL,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"trial_task_key" text,
	"impossible" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "onboarding_process_run_key_uq" UNIQUE("run_id","key")
);--> statement-breakpoint
ALTER TABLE "onboarding_process" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "onboarding_process" ADD CONSTRAINT "onboarding_process_run_id_repository_onboarding_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."repository_onboarding_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_process" ADD CONSTRAINT "onboarding_process_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "onboarding_process_tenant_isolation" ON "onboarding_process" AS PERMISSIVE FOR ALL TO public USING (client_id = current_setting('app.current_client', true)::uuid) WITH CHECK (client_id = current_setting('app.current_client', true)::uuid);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "onboarding_trial" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"phase" text NOT NULL,
	"task_key" text NOT NULL,
	"title" text NOT NULL,
	"prompt" text NOT NULL,
	"passed" boolean,
	"failure_kind" text,
	"detail" text DEFAULT '' NOT NULL,
	"answer" text DEFAULT '' NOT NULL,
	"judged_by" text DEFAULT '' NOT NULL,
	"cost_usd" numeric(12, 6) DEFAULT '0' NOT NULL,
	"call_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "onboarding_trial" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "onboarding_trial" ADD CONSTRAINT "onboarding_trial_run_id_repository_onboarding_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."repository_onboarding_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_trial" ADD CONSTRAINT "onboarding_trial_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "onboarding_trial_run_idx" ON "onboarding_trial" ("run_id","phase");--> statement-breakpoint
CREATE POLICY "onboarding_trial_tenant_isolation" ON "onboarding_trial" AS PERMISSIVE FOR ALL TO public USING (client_id = current_setting('app.current_client', true)::uuid) WITH CHECK (client_id = current_setting('app.current_client', true)::uuid);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "onboarding_component" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"key" text NOT NULL,
	"kind" text NOT NULL,
	"family" text NOT NULL,
	"title" text NOT NULL,
	"why" text NOT NULL,
	"what" text NOT NULL,
	"source" text NOT NULL,
	"source_ref" text,
	"group" text NOT NULL,
	"risk" text NOT NULL,
	"context_tokens" integer,
	"verify_how" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"files" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"validation" jsonb,
	"delta" jsonb,
	"questions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decline_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "onboarding_component_run_key_uq" UNIQUE("run_id","key")
);--> statement-breakpoint
ALTER TABLE "onboarding_component" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "onboarding_component" ADD CONSTRAINT "onboarding_component_run_id_repository_onboarding_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."repository_onboarding_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_component" ADD CONSTRAINT "onboarding_component_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "onboarding_component_run_idx" ON "onboarding_component" ("run_id","family");--> statement-breakpoint
CREATE POLICY "onboarding_component_tenant_isolation" ON "onboarding_component" AS PERMISSIVE FOR ALL TO public USING (client_id = current_setting('app.current_client', true)::uuid) WITH CHECK (client_id = current_setting('app.current_client', true)::uuid);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "repo_coach_proposal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repo_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"component_key" text,
	"title" text NOT NULL,
	"why" text NOT NULL,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"measure" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decline_reason" text,
	"run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "repo_coach_proposal" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "repo_coach_proposal" ADD CONSTRAINT "repo_coach_proposal_repo_id_repo_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repo"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repo_coach_proposal" ADD CONSTRAINT "repo_coach_proposal_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "repo_coach_proposal_repo_idx" ON "repo_coach_proposal" ("repo_id","status");--> statement-breakpoint
CREATE POLICY "repo_coach_proposal_tenant_isolation" ON "repo_coach_proposal" AS PERMISSIVE FOR ALL TO public USING (client_id = current_setting('app.current_client', true)::uuid) WITH CHECK (client_id = current_setting('app.current_client', true)::uuid);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "marketplace_source" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"publisher" text,
	"description" text,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"trust" text DEFAULT 'unverified' NOT NULL,
	"trust_checks" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"tool_count" integer,
	"context_tokens" integer,
	"found_by" text DEFAULT 'model' NOT NULL,
	"used_in_repos" integer DEFAULT 0 NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"changed_at" timestamp with time zone,
	CONSTRAINT "marketplace_source_kind_url_uq" UNIQUE("kind","url")
);--> statement-breakpoint

-- The line next to each changed file in the old review is gone: a component
-- card carries its own explanation, written by the code from the evidence.
DELETE FROM "prompt_template" WHERE "key" = 'onboarding.file_notes';--> statement-breakpoint

INSERT INTO "prompt_template" ("key", "title", "description", "sort_order", "body", "body_he") VALUES (
'onboarding.processes',
'הטמעת מאגר — פירוק התהליכים לצעדים',
'רץ פעם אחת בשלב "תהליכים וראיון" של הטמעת מאגר: קלוד מקבל את הפרופיל, את הראיות לתהליכים (היסטוריית git, CI, CONTRIBUTING, תבנית PR, תיעוד) ואת תשובות הראיון, ומפרק כל תהליך לצעדים. לכל צעד הוא עונה על חמש שאלות מבחן הסוכן; הקוד מחליט מהתשובות אם צריך סוכן, skill או כלום. את שמות השדות בתשובה הקוד קורא — הם חייבים להישאר.',
1,
$p$You are mapping how work is actually done in the repository "{{REPO_NAME}}", so that an AI coding agent can be given the right helpers for THIS repository — never a fixed list. You have read-only tools (Read, Grep, Glob) on the repository; read CONTRIBUTING, CI workflows, docs and templates when the evidence points at them, and read as little as you need.

THE REPOSITORY (deterministic diagnosis, trust it over your own guesses):
{{PROFILE}}

EVIDENCE OF PROCESSES gathered by the code (git change shapes, CI steps, contribution rules, PR template, docs, tracker):
{{EVIDENCE}}

WHAT THE PEOPLE ANSWERED (an answer marked "assumed" was a default nobody confirmed):
{{INTERVIEW}}

Task: list the processes — the recurring kinds of change made here (for example: add a field to an entity, release a version, review a pull request, bump dependencies, add a migration, add an integration). Only processes the evidence supports; say the evidence. For each process, break it into 2–6 concrete steps in the order they happen here. For EVERY step answer the agent test — five yes/no questions with one sentence of why:
- judgment: does the step need independent judgment (a second opinion, a review, a decision that should not be made by the one who wrote the code)?
- externalInfo: does it need information or access the main agent does not have (a live system, a schema outside the repository, a tracker, credentials)?
- readsALot: does it have to read a lot (many files, long logs, a whole subsystem)?
- parallel: can it run beside the main work rather than in its middle?
- failsToday: does the evidence or the trial show it going wrong today?
Answer yes only when it is clearly true for THIS step in THIS repository — most steps of most processes get five no's; a yes needs a concrete reason in `why`. Do not decide agent/skill/none — the code decides from your answers. Do not invent processes to fill a list: a repository with one commit and no CI may have two processes.

Answer with ONLY this JSON, nothing before or after it:
{"processes": [{"key": "snake_case", "title": "short English title", "source": "git|ci|contributing|pr_template|docs|tracker|interview|model", "evidence": ["what showed it, with file paths or counts"], "steps": [{"key": "snake_case", "title": "short English title", "what": "one sentence: what happens in this step here", "agentTest": {"judgment": false, "externalInfo": false, "readsALot": false, "parallel": false, "failsToday": false, "why": "one sentence"}}]}]}$p$,
NULL
) ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint

INSERT INTO "prompt_template" ("key", "title", "description", "sort_order", "body", "body_he") VALUES (
'onboarding.trial',
'הטמעת מאגר — משימת ניסיון',
'רץ בשלב "ריצת ניסיון" של הטמעת מאגר, פעם למשימה, לפני הבנייה ואחריה: קלוד מקבל משימה ייצוגית אחת ועובד בעותק המבודד בלי שום רכיב, כדי לראות מה הוא מצליח כאן לבד. הקוד או מודל שופט אחר מכריעים אם עבר. את השורה שמתחילה ב-RESULT: הקוד קורא — היא חייבת להישאר.',
2,
$p$You are working in this repository with no instructions, no memory and no helpers — exactly as an agent would on its first day here. Do the task below. Read the repository as much as you need; you may run read-only commands. Do NOT modify, create or delete any file, and do not run anything that changes the repository, installs packages, or reaches a network service.

TASK:
{{TASK}}

Answer in English. First, what you did and what you found (the files, the commands, the facts), briefly. If you could not verify something here — say that you could not, and why, instead of guessing. End with ONE line that starts with "RESULT: " followed by the answer to the task in one sentence.$p$,
NULL
) ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint

INSERT INTO "prompt_template" ("key", "title", "description", "sort_order", "body", "body_he") VALUES (
'onboarding.judge',
'הטמעת מאגר — שופט של משימת ניסיון',
'רץ בשלב "ריצת ניסיון" של הטמעת מאגר, רק למשימה שהקוד לא יכול לשפוט לבד. מודל אחר מזה שביצע את המשימה מקבל את המשימה, את העובדות מהאבחון ואת התשובה, ומכריע אם עברה ואם לא — מאיזה סוג הכישלון. את שמות השדות בתשובה ("passed", "failureKind", "detail") הקוד קורא — הם חייבים להישאר.',
3,
$p$You judge whether an AI coding agent did a task correctly in a software repository. You did not do the task; you only read the answer. Be strict and literal: a confident claim that contradicts a fact below is a failure, and "I could not verify" is honest, not a failure, when the facts say it cannot be verified here.

THE TASK:
{{TASK}}

FACTS ABOUT THE REPOSITORY (from a deterministic diagnosis — treat them as true):
{{FACTS}}

THE AGENT'S ANSWER:
{{ANSWER}}

Decide: passed, or failed with exactly one kind:
- missing_fact — it did not know a fact about the repository (a command, a path, a convention) and got it wrong or guessed;
- rule_violated — it knew (or the facts say it should have known) and still did the wrong thing;
- needs_external — it could not answer without information or access outside the repository (a live system, a schema, credentials);
- cannot_verify — it claimed success it could not have checked here (no build or test runs here), or it needed to run something it could not;
- bad_judgment — it had the facts and chose wrongly (wrong file, wrong approach, unsafe change).

Answer with ONLY this JSON, nothing before or after it:
{"passed": true, "failureKind": null, "detail": "one sentence in Hebrew saying what was right or what went wrong; file paths and commands stay in backticks"}
When it failed: {"passed": false, "failureKind": "missing_fact|rule_violated|needs_external|cannot_verify|bad_judgment", "detail": "..."}$p$,
NULL
) ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint

INSERT INTO "prompt_template" ("key", "title", "description", "sort_order", "body", "body_he") VALUES (
'onboarding.marketplace',
'הטמעת מאגר — חיפוש רכיבים מוכנים לסטאק',
'רץ בשלב "תוכנית הרכיבים" של הטמעת מאגר, פעם לכל תגית סטאק שאין לה עדיין מקורות שנזכרו: קלוד מחפש ברשת plugins, שרתי MCP, ספריות skills ותוספי LSP שמתאימים לסטאק של הריפו, ומחזיר את מה שמצא עם מי פרסם ומה ידוע עליו. הקוד מריץ בדיקות אמון על כל מקור ומדרג אותו; מקור לא מאומת לעולם לא מותקן לבד. את שמות השדות בתשובה הקוד קורא — הם חייבים להישאר.',
4,
$p$You search the web for ready-made components an AI coding agent (Claude Code) could use in a repository with this stack. Use web search and fetch pages to confirm what you report; report only what you actually found at a real address, never something you assume exists.

THE STACK (tags the diagnosis derived, most important first): {{STACK}}
THE REPOSITORY IN ONE PARAGRAPH: {{PROFILE_SUMMARY}}
ALREADY KNOWN (do not report these again; you may confirm they still exist): {{KNOWN}}

Look for, in this order of trust: the vendor's or maintainer's own components (Microsoft, HashiCorp, GitHub, Atlassian, Anthropic, the language's own team); Anthropic's official Claude Code plugin marketplace (anthropics/claude-plugins-official); the official MCP registry under a vendor namespace; the Docker MCP catalog; well-known community skills libraries. Kinds: "plugin" (a Claude Code plugin or marketplace entry), "mcp" (an MCP server), "skill" (a skills library), "lsp" (a language-server plugin such as csharp-lsp, typescript-lsp, pyright-lsp, jdtls-lsp, gopls-lsp). Skip anything that is only a blog post. For an MCP server, count its tools when the page says, and say whether a read-only mode exists.

Answer with ONLY this JSON, nothing before or after it, at most 12 entries:
{"sources": [{"kind": "plugin|mcp|skill|lsp", "name": "…", "url": "https://…", "publisher": "who maintains it", "description": "one sentence", "tags": ["stack tags it serves"], "official": true, "why": "one sentence: what it gives an agent in THIS repository", "toolCount": null, "readOnly": null, "license": null, "lastActivity": "YYYY-MM or null"}]}$p$,
NULL
) ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint

INSERT INTO "prompt_template" ("key", "title", "description", "sort_order", "body", "body_he") VALUES (
'onboarding.author',
'הטמעת מאגר — כתיבת תוכן של רכיב',
'רץ בשלב "בנייה ואימות" של הטמעת מאגר, פעם לכל רכיב שהתוכן שלו הוא טקסט שצריך לנסח מהריפו (AGENTS.md, מסמך ב-docs, גוף של skill, רשימת בדיקה של סוכן): קלוד קורא את הריפו וכותב את הקובץ לפי ההנחיות. הקוד מאמת טענות שאפשר לבדוק מול הפרופיל לפני שהקובץ נכנס לענף. התשובה היא תוכן הקובץ בלבד.',
5,
$p$You write ONE file for an AI coding agent's setup in the repository "{{REPO_NAME}}". You have read-only tools (Read, Grep, Glob) on the repository: read what you need to make every sentence true here, and nothing more. Everything you write must be specific to THIS repository and checkable in it — no generic advice, no filler, nothing the agent would discover by itself in a minute (a folder listing, the obvious). Prefer facts the diagnosis established; when you state a command, a path or a convention, it must exist in the repository.

THE REPOSITORY (deterministic diagnosis):
{{PROFILE_SUMMARY}}

THE COMPONENT TO WRITE:
{{COMPONENT}}
{{#PROCESS}}
THE PROCESS IT SERVES (steps as they happen here):
{{PROCESS}}
{{/PROCESS}}{{#EVIDENCE}}
EVIDENCE TO CITE (review comments, bugs, history — quote the specific ones that justify each item):
{{EVIDENCE}}
{{/EVIDENCE}}
FORMAT REQUIRED:
{{FORMAT}}

Answer with ONLY the file's content, nothing before or after it — no explanation, no code fence around the whole file.$p$,
NULL
) ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint

INSERT INTO "prompt_template" ("key", "title", "description", "sort_order", "body", "body_he") VALUES (
'onboarding.review',
'הטמעת מאגר — סוקר התוכנית: מה חסר ומה מיותר',
'רץ פעם אחת בסוף שלב "תוכנית הרכיבים" של הטמעת מאגר: סוקר נפרד מקבל את הפרופיל, את התהליכים, את תוצאות הניסיון ואת רשימת הרכיבים המוצעים, ושואל מה חסר ומה מיותר. כל מה שהוא מעלה הופך לכרטיס לאישור — הוא לא מחליט. את שמות השדות בתשובה ("missing", "redundant") הקוד קורא — הם חייבים להישאר.',
6,
$p$You review a plan for setting up an AI coding agent in the repository "{{REPO_NAME}}". You did not write the plan. Your one job: what is MISSING that the evidence calls for, and what is REDUNDANT — duplicated, contradicted, or not justified by this repository's evidence. You do not approve and you do not praise; an empty list is a fine answer when the plan fits.

THE REPOSITORY (deterministic diagnosis):
{{PROFILE_SUMMARY}}

THE PROCESSES FOUND HERE, with the decision per step:
{{PROCESSES}}

THE TRIAL RUN (tasks the agent did with no helpers, and how each failed):
{{TRIALS}}

THE PLAN (every proposed component, its kind, its evidence and its group):
{{COMPONENTS}}

Rules: a missing item must point at evidence above (a failed trial with no component answering it; a process step decided "agent" with no agent; a secret with no protection; a generated path with no guard). A redundant item must say what it duplicates or contradicts. Do not propose generic components ("add tests") without evidence that the problem exists here. At most 6 items in total.

Answer with ONLY this JSON, nothing before or after it:
{"missing": [{"kind": "rule|hook|permission|skill|agent|mcp|plugin|lsp|scaffold|doc|script", "title": "short Hebrew title", "why": "one sentence in Hebrew naming the evidence"}], "redundant": [{"key": "the component's key from the plan", "why": "one sentence in Hebrew"}]}$p$,
NULL
) ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint

INSERT INTO "prompt_template" ("key", "title", "description", "sort_order", "body", "body_he") VALUES (
'onboarding.request',
'הטמעת מאגר — בקשה של אדם לרכיב ("תכין skill לתהליך X")',
'רץ כשאדם מבקש בצ''אט רכיב שאינו בתוכנית ("תכין skill לתהליך X"): קלוד הופך את הבקשה לכרטיס — סוג, כותרת, מה הרכיב יעשה — ועד שלוש שאלות הבהרה עם ברירת מחדל. הכרטיס נבנה ומאומת כמו כל רכיב אחר, והאדם מחליט אם הוא עזר. את שמות השדות בתשובה ("kind", "title", "questions") הקוד קורא — הם חייבים להישאר.',
7,
$p$A person asked, in their own words, for a helper to be added to the AI coding agent's setup in the repository "{{REPO_NAME}}". Turn the request into one component card. Choose the kind that fits what they described: a skill (a written procedure the agent follows for a recurring task), an agent (a separate helper with its own judgment or access), a hook (something enforced on every action), a rule (a line of instructions), a doc, or an mcp connection. Ask at most three clarifying questions, only when the answer changes what gets built, each with a sensible default so the card can be built without an answer.

THE REQUEST:
{{REQUEST}}

THE REPOSITORY (deterministic diagnosis):
{{PROFILE_SUMMARY}}

THE PROCESSES ALREADY FOUND HERE:
{{PROCESSES}}

Answer with ONLY this JSON, nothing before or after it:
{"kind": "skill|agent|hook|rule|doc|mcp", "title": "short Hebrew title", "what": "one or two sentences in Hebrew: what it will do here", "questions": [{"key": "snake_case", "question_he": "the question in Hebrew", "default": "the default answer"}]}$p$,
NULL
) ON CONFLICT ("key") DO NOTHING;
