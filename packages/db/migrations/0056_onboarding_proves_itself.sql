-- 0056 — onboarding proves itself (openspec/changes/onboarding-proves-itself).
--
-- The trial becomes a measurement: every task runs in two arms — without the
-- delivered set (phase "baseline") and with exactly the delivered set (phase
-- "after") — n times each, graded by the code first and by a judge that reads
-- the copy only where the code cannot decide. A row is one run of one task in
-- one arm; `run_index` tells the runs apart, `num_turns` and `graders` say
-- what happened, `exercises` names the components the task measures.
ALTER TABLE "onboarding_trial" ADD COLUMN IF NOT EXISTS "run_index" integer NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE "onboarding_trial" ADD COLUMN IF NOT EXISTS "num_turns" integer;--> statement-breakpoint
ALTER TABLE "onboarding_trial" ADD COLUMN IF NOT EXISTS "graders" jsonb NOT NULL DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "onboarding_trial" ADD COLUMN IF NOT EXISTS "exercises" jsonb NOT NULL DEFAULT '{}'::jsonb;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "onboarding_trial_task_idx" ON "onboarding_trial" ("run_id", "phase", "task_key", "run_index");--> statement-breakpoint

-- The task prompt no longer tells the agent it has "no instructions, no memory
-- and no helpers": in the "with" arm that was false, and the isolation is the
-- CLI's (`--setting-sources project`), not the text's. An action task may
-- change files in its throw-away copy. Changed only where no person has edited the prompt.
UPDATE "prompt_template" SET "body" = $p$You are working in the repository in the current folder as a developer on this team would, with whatever instructions and helpers this repository carries for you. Do the task below. Read the repository as much as you need; you may run commands. {{#EDITS}}You may create and change files in this working copy. Do not push, do not install packages from the network, do not reach any network service, and do not run anything that changes a live system.{{/EDITS}}{{^EDITS}}Do NOT modify, create or delete any file, and do not run anything that changes the repository, installs packages, or reaches a network service.{{/EDITS}}

TASK:
{{TASK}}

Answer in English. First, what you did and what you found — the files, the commands you ran and what they returned, the facts — briefly. Say only what you saw: if you could not verify something here, say that you could not and why, instead of guessing, and never report a build or a test result you did not see run. End with ONE line that starts with "RESULT: " followed by the answer to the task in one sentence.$p$,
  "description" = $d$רץ במדידה של הטמעת מאגר, פעם לכל הרצה של משימה בכל זרוע — בלי הסט שנמסר (צעד ריצת הניסיון) ועם בדיוק הסט שנמסר (אחרי הבנייה): קלוד עובד בעותק מבודד שטוען רק את ההגדרות של העותק עצמו. משימת פעולה (EDITS) רשאית לשנות קבצים בעותק. הקוד שופט ממה שהשתנה, מה רץ ומה נחסם; שופט שקורא את העותק מכריע רק כשהקוד לא יכול. את השורה שמתחילה ב-RESULT: הקוד קורא — היא חייבת להישאר.$d$
WHERE "key" = 'onboarding.trial' AND "updated_by" IS NULL;--> statement-breakpoint

-- The judge can look. It reads the arm's copy (Read, Grep, Glob) and checks every
-- claim in the answer against it; the diagnosis facts are hints, never the truth
-- (a judge without tools failed a right answer because its "facts" were narrower
-- than the repository — the TRADE audit). It also gets what the code graders found.
UPDATE "prompt_template" SET "body" = $p$You judge whether an AI coding agent did a task correctly in a software repository. You did not do the task; you read the answer and you CHECK it against the repository itself{{#COPY_DIR}}, which you can read at {{COPY_DIR}} (Read, Grep, Glob){{/COPY_DIR}}. Open the files and run the searches needed to verify every path, command, project and convention the answer names — a claim you did not verify is not accepted as true. Be strict and literal: a confident claim that contradicts what the repository shows is a failure; "I could not verify" is honest, not a failure, when the repository really cannot show it here.

THE TASK:
{{TASK}}
{{#EXPECT}}
WHAT A RIGHT ANSWER ESTABLISHES:
{{EXPECT}}
{{/EXPECT}}
HINTS FROM A DETERMINISTIC DIAGNOSIS (they may be incomplete or too narrow — the repository decides, not these lines):
{{FACTS}}
{{#CLAIMS}}
WHAT THE CODE GRADERS ALREADY FOUND (what changed, what ran, what was blocked, what was claimed):
{{CLAIMS}}
{{/CLAIMS}}
THE AGENT'S ANSWER:
{{ANSWER}}

Decide: passed, or failed with exactly one kind:
- missing_fact — it did not know a fact about the repository (a command, a path, a convention) and got it wrong or guessed;
- rule_violated — it knew (or should have known from what the repository carries) and still did the wrong thing;
- needs_external — it could not answer without information or access outside the repository (a live system, a schema, credentials) and did not say so;
- cannot_verify — it claimed success it could not have checked here, or it needed to run something it could not;
- bad_judgment — it had the facts and chose wrongly (wrong file, wrong approach, unsafe change).

Answer with ONLY this JSON, nothing before or after it:
{"passed": true, "failureKind": null, "detail": "one sentence in Hebrew saying what was right or what went wrong, naming what you checked; file paths and commands stay in backticks"}
When it failed: {"passed": false, "failureKind": "missing_fact|rule_violated|needs_external|cannot_verify|bad_judgment", "detail": "..."}$p$,
  "description" = $d$רץ במדידה של הטמעת מאגר, רק למשימה שהקוד לא יכול לשפוט לבד. קריאה נפרדת עם גישה לקריאת העותק (Read, Grep, Glob) מקבלת את המשימה, את תשובת הסוכן, את מה ששופטי הקוד כבר מצאו ואת עובדות האבחון כרמזים בלבד — ובודקת כל טענה מול הקוד לפני שהיא מכריעה אם עברה ואם לא, מאיזה סוג הכישלון. את שמות השדות בתשובה ("passed", "failureKind", "detail") הקוד קורא — הם חייבים להישאר.$d$
WHERE "key" = 'onboarding.judge' AND "updated_by" IS NULL;--> statement-breakpoint

-- The reviewer names the process step a missing helper serves, so the build can
-- name the file from stable keys (a reviewer's skill card used to be written to
-- `.claude/skills/undefined-undefined/`).
UPDATE "prompt_template" SET "body" = replace("body",
  $a${"missing": [{"kind": "rule|hook|permission|skill|agent|mcp|plugin|lsp|scaffold|doc|script", "title": "short Hebrew title", "why": "one sentence in Hebrew naming the evidence"}], "redundant": [{"key": "the component's key from the plan", "why": "one sentence in Hebrew"}]}$a$,
  $b${"missing": [{"kind": "rule|hook|permission|skill|agent|mcp|plugin|lsp|scaffold|doc|script", "title": "short Hebrew title", "why": "one sentence in Hebrew naming the evidence", "processKey": "the key of the process above it serves, or null", "stepKey": "the key of that process's step, or null", "slug": "a short ascii-kebab-case name for the file, e.g. run-mstest"}], "redundant": [{"key": "the component's key from the plan", "why": "one sentence in Hebrew"}]}$b$)
WHERE "key" = 'onboarding.review' AND "updated_by" IS NULL;--> statement-breakpoint

-- The author gets one fix attempt with the validator's message, and two rules the
-- TRADE files broke: no personal paths or identifiers copied into new text, no
-- command that was not verified to exist here.
UPDATE "prompt_template" SET "body" = replace("body",
  $a$Answer with ONLY the file's content, nothing before or after it — no explanation, no code fence around the whole file.$a$,
  $b$Two rules with no exception: never copy a personal path, a user name, a subscription or tenant id, a connection string or any secret-looking value into what you write, even when the repository contains it — name the file that holds it instead; and never write a command you did not verify exists here (a tool on this machine, a script in the repository, a target in its build files).
{{#FIX}}
A VALIDATOR REJECTED THE PREVIOUS ATTEMPT — fix exactly this and write the whole file again, nothing else changed:
{{FIX}}
{{/FIX}}
Answer with ONLY the file's content, nothing before or after it — no explanation, no code fence around the whole file, and when the format requires frontmatter the very first line is `---`.$b$)
WHERE "key" = 'onboarding.author' AND "updated_by" IS NULL;
