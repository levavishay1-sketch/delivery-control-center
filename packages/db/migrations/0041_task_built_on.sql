-- 0041 — a task can be developed before the tasks it depends on are
-- finished. Its branch starts from the branch of the dependency whose work
-- already exists (not the default branch), so Claude builds on it; what was
-- not in that base is recorded, and a check that needs it waits instead of
-- failing. See packages/core/src/task-base.ts.
ALTER TABLE "task" ADD COLUMN IF NOT EXISTS "base_task_id" uuid REFERENCES "task"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN IF NOT EXISTS "base_branch" text;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN IF NOT EXISTS "base_sha" text;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN IF NOT EXISTS "built_without" jsonb NOT NULL DEFAULT '[]'::jsonb;--> statement-breakpoint

-- The development prompt says what the branch already holds and what it
-- does not, and a check that cannot be verified without a missing
-- dependency reports that instead of a failure. Edited in place (not
-- replaced), so a wording a person changed on the Prompts screen stays.
UPDATE "prompt_template" SET
  "body" = replace(replace(replace("body",
    $a$Appetite: {{APPETITE}}
{{#CHECKS}}$a$,
    $b$Appetite: {{APPETITE}}
{{#BUILT_ON}}
BUILT ON — this branch starts from the branch of a task this one depends on, which is not in the default branch yet: {{BUILT_ON}}. That work is already here: build on it, do not redo it.
{{/BUILT_ON}}{{#MISSING}}
NOT HERE YET — this task depends on work that is not in this branch: {{MISSING}}. Build everything you can against the code as it is. Where you need that work, write against the shape it will most likely have, keep each such assumption small and obvious, and name every one in "followUps" so the task can be revisited once that work exists.
{{/MISSING}}{{#CHECKS}}$b$),
    $a$"likelyCause": "implementation"|"requirement_ambiguity"|null}$a$,
    $b$"likelyCause": "implementation"|"requirement_ambiguity"|"dependency_missing"|null}$b$),
    $a$that is a signal an earlier stage under-specified this, not something to guess past.$a$,
    $b$that is a signal an earlier stage under-specified this, not something to guess past. "dependency_missing" if the check cannot be verified because it needs work from a task this one depends on that is not in this branch yet — that is waiting, not a failure of this task.$b$),
  "body_he" = replace(replace(replace("body_he",
    $a$היקף: {{APPETITE}}
{{#CHECKS}}$a$,
    $b$היקף: {{APPETITE}}
{{#BUILT_ON}}
בנוי על — הענף הזה מתחיל מהענף של משימה שהמשימה הזו תלויה בה, ושעוד לא נכנסה לענף הראשי: {{BUILT_ON}}. העבודה שלה כבר כאן: בנה עליה, אל תעשה אותה שוב.
{{/BUILT_ON}}{{#MISSING}}
עוד לא כאן — המשימה הזו תלויה בעבודה שלא נמצאת בענף הזה: {{MISSING}}. בנה כל מה שאפשר מול הקוד כפי שהוא. איפה שאתה צריך את העבודה ההיא, כתוב מול הצורה שהיא כנראה תקבל, שמור כל הנחה כזו קטנה וברורה, ופרט כל אחת ב-"followUps" כדי שאפשר יהיה לחזור למשימה כשהעבודה ההיא תהיה קיימת.
{{/MISSING}}{{#CHECKS}}$b$),
    $a$"likelyCause": "implementation"|"requirement_ambiguity"|null}$a$,
    $b$"likelyCause": "implementation"|"requirement_ambiguity"|"dependency_missing"|null}$b$),
    $a$סימן ששלב קודם לא הגדיר אותה מספיק, לא משהו לנחש מעליו.$a$,
    $b$סימן ששלב קודם לא הגדיר אותה מספיק, לא משהו לנחש מעליו. "dependency_missing" אם אי אפשר לאמת את הבדיקה כי היא צריכה עבודה של משימה שהמשימה הזו תלויה בה ושעוד לא בענף — זו המתנה, לא כישלון של המשימה.$b$)
WHERE "key" = 'implement.task';
