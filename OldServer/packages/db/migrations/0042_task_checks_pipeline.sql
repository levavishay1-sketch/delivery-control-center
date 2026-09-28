-- 0042 — every task is verified the same way: after it is developed, DCC
-- builds it and then runs its checks, in separate steps, with no write
-- access. Three checks are added to every task by DCC itself — the build of
-- what it compiles into, the tests for what it added, regression — and an
-- end-to-end check on request. Their instructions are prompts on the Prompts
-- screen; each task gets its own copy, editable there.
ALTER TABLE "task" ADD COLUMN IF NOT EXISTS "check_kind" text;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN IF NOT EXISTS "check_cause" text;--> statement-breakpoint

INSERT INTO "prompt_template" ("key", "title", "description", "sort_order", "body", "body_he") VALUES (
'check.build',
'בדיקת Build — הרכיבים המתקמפלים',
'בדיקה ש-DCC מוסיף לכל משימה בעצמו: בונה את הרכיבים שהשינוי מתקמפל אליהם (מה שהפירוק זיהה ב-compiledComponents). הטקסט הזה הופך להוראה של הבדיקה ברגע שהיא נוצרת, ואפשר לערוך אותה אחר כך במשימה עצמה.',
1,
$p$Build לשינוי: בנה את מה שהשינוי הזה מתקמפל אליו, ודווח אם הוא נבנה.
{{#COMPILED}}הפרויקטים לבנייה: {{COMPILED}}.{{/COMPILED}}{{^COMPILED}}לא פורטו פרויקטים מתקמפלים למשימה — מצא מה בונה את הקבצים שהיא שינתה ובנה אותו. אם שום דבר ממה שהיא שינתה לא מתקמפל (סקריפטים, קונפיגורציה, web resources) — אמור את זה, וזה נחשב עבר.{{/COMPILED}}
השתמש בדרך הבנייה של המאגר עצמו (קובצי ה-solution או ה-project שלו, `dotnet build`, `msbuild`, `npm run build` — מה שהוא משתמש בו). רק לבנות — לא לשנות שום דבר כדי שייבנה.$p$,
NULL
) ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint

INSERT INTO "prompt_template" ("key", "title", "description", "sort_order", "body", "body_he") VALUES (
'check.tests',
'בדיקות לפיתוח',
'בדיקה ש-DCC מוסיף לכל משימה בעצמו: מריצה את הבדיקות שהפיתוח חייב להוסיף להיגיון החדש, יחד עם הבדיקות הקיימות של הקוד שהשתנה. היגיון חדש בלי בדיקה — נכשל. הטקסט הזה הופך להוראה של הבדיקה ברגע שהיא נוצרת.',
2,
$p$בדיקות לפיתוח: הפיתוח היה חייב להוסיף בדיקות להיגיון שהוא הוסיף או שינה. מצא אותן (בקבצים שהמשימה שינתה) והרץ אותן, יחד עם הבדיקות הקיימות של הקוד שהיא שינתה{{#PATHS}} ({{PATHS}}){{/PATHS}}. כולן חייבות לעבור. היגיון חדש בלי בדיקה — זה כישלון: אמור לאיזה היגיון אין בדיקה. אם במאגר אין שום דרך להריץ בדיקות — אמור את זה.$p$,
NULL
) ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint

INSERT INTO "prompt_template" ("key", "title", "description", "sort_order", "body", "body_he") VALUES (
'check.regression',
'בדיקות רגרסיה',
'בדיקה ש-DCC מוסיף לכל משימה בעצמו: מריצה את הבדיקות הקיימות של מי שמשתמש בקוד שהשתנה, כדי לוודא ששום דבר שעבד לא נשבר. כישלון שקיים גם בלי השינוי אינו רגרסיה. הטקסט הזה הופך להוראה של הבדיקה ברגע שהיא נוצרת.',
3,
$p$בדיקות רגרסיה: שום דבר שעבד לפני השינוי לא אמור להישבר בגללו. הרץ את הבדיקות הקיימות של הקוד שמשתמש במה שהמשימה שינתה — מי שקורא לו ומי שתלוי בו{{#PATHS}}, סביב {{PATHS}}{{/PATHS}} — ושל המודולים שהקבצים האלה שייכים להם. לכל כישלון, אמור אם השינוי הזה גרם לו: קרא את הקוד שנכשל, ואם יש ספק השווה לענף הראשי עם git לקריאה בלבד (`git show`, `git diff`). כישלון שקיים גם בלי השינוי אינו רגרסיה — פרט אותו, והבדיקה עוברת.$p$,
NULL
) ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint

INSERT INTO "prompt_template" ("key", "title", "description", "sort_order", "body", "body_he") VALUES (
'check.e2e',
'בדיקות E2E',
'לבחירה: נוספת למשימה רק כשלוחצים "הוסף בדיקות E2E" במסך המשימה. מריצה את התהליך כולו כמו משתמש, בכלי ה-end-to-end של המאגר. הטקסט הזה הופך להוראה של הבדיקה ברגע שהיא נוצרת.',
4,
$p$בדיקות E2E: הפעל את כל התהליך שהמשימה הזו חלק ממנו, כמו שמשתמש היה עושה, בכלי ה-end-to-end שיש במאגר (חבילת בדיקות E2E, פרויקט בדיקות UI, תרחישים מתוסרטים). הרץ את התרחישים שמכסים את ההתנהגות של המשימה{{#INTENT}} ({{INTENT}}){{/INTENT}}, ודווח על כל אחד. אם אין במאגר כלי end-to-end, או שאי אפשר להריץ אותו כאן — אמור בדיוק מה חסר. אל תמציא סימולציה.$p$,
NULL
) ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint

INSERT INTO "prompt_template" ("key", "title", "description", "sort_order", "body", "body_he") VALUES (
'checks.run',
'הרצת הבדיקות של משימה',
'רץ אחרי הפיתוח של משימה, בשני שלבים: קודם בדיקות ה-Build, ואם הן עברו — כל השאר (בדיקות לפיתוח, רגרסיה, E2E, ובדיקות שהפירוק הציע). רץ גם כשמריצים בדיקה אחת לבד. ל-Claude אין כאן הרשאה לשנות קבצים — רק לקרוא ולהריץ פקודות. את שמות השדות בתשובה הקוד קורא — הם חייבים להישאר.',
1,
$p$You are VERIFYING a change in this repository — the work of one task, already made and committed on this branch. You may read code and run commands (a build, tests). You must NOT change, create or delete any file, and must not commit: a check that changes code proves nothing. Build outputs that the build itself writes are fine.

THE TASK that was implemented: {{INTENT}}
Files it changed: {{CHANGED_FILES}}
{{#BUILT_ON}}
This branch also holds the work of a task it depends on: {{BUILT_ON}}.
{{/BUILT_ON}}{{#MISSING}}
It was developed WITHOUT work it depends on, which is not in this branch: {{MISSING}}.
{{/MISSING}}
CONTEXT — the requirement it came from (Hebrew):
{{CONTEXT}}

CHECKS — perform each one, in order, and report each by its number; do not skip any:
{{CHECKS}}

"passed" is true only if you actually ran the check and it held. When it did not pass, "likelyCause" says why:
- "implementation" — the change is wrong;
- "requirement_ambiguity" — what is expected is itself unclear, a sign an earlier stage under-specified it;
- "dependency_missing" — it needs work from a task this one depends on that is not in this branch yet: waiting, not a failure of this task;
- "environment" — it could not run here (a missing SDK, tool, service or credentials); say exactly what is missing.

IMPORTANT: write every "detail" and the "summary" IN HEBREW (code identifiers, commands and paths stay English).

Respond with ONLY this JSON, no prose, no markdown fence:
{"summary": string, "checks": [{"seq": number, "passed": boolean, "detail": string, "likelyCause": "implementation"|"requirement_ambiguity"|"dependency_missing"|"environment"|null}]}$p$,
$p$אתה מאמת שינוי במאגר הזה — העבודה של משימה אחת, שכבר נעשתה ונשמרה ב-commit בענף הזה. מותר לקרוא קוד ולהריץ פקודות (build, בדיקות). אסור לשנות, ליצור או למחוק שום קובץ, ואסור לעשות commit: בדיקה שמשנה קוד לא מוכיחה כלום. תוצרים שה-build עצמו כותב — בסדר.

המשימה שמומשה: {{INTENT}}
הקבצים שהיא שינתה: {{CHANGED_FILES}}
{{#BUILT_ON}}
הענף הזה מחזיק גם את העבודה של משימה שהמשימה הזו תלויה בה: {{BUILT_ON}}.
{{/BUILT_ON}}{{#MISSING}}
היא פותחה בלי עבודה שהיא תלויה בה, שלא נמצאת בענף הזה: {{MISSING}}.
{{/MISSING}}
הקשר — הדרישה שהיא באה ממנה:
{{CONTEXT}}

הבדיקות — בצע כל אחת, לפי הסדר, ודווח על כל אחת לפי המספר שלה; בלי לדלג:
{{CHECKS}}

"passed" הוא true רק אם באמת הרצת את הבדיקה והיא התקיימה. כשהיא לא עברה, "likelyCause" אומר למה:
- "implementation" — השינוי שגוי;
- "requirement_ambiguity" — מה שמצופה בעצמו לא ברור, סימן ששלב קודם לא הגדיר אותו מספיק;
- "dependency_missing" — היא צריכה עבודה של משימה שהמשימה הזו תלויה בה, שעוד לא בענף: המתנה, לא כישלון של המשימה;
- "environment" — אי אפשר היה להריץ אותה כאן (SDK, כלי, שירות או הרשאות חסרים); אמור בדיוק מה חסר.

חשוב: כתוב כל "detail" ואת ה-"summary" בעברית (שמות בקוד, פקודות ונתיבים נשארים באנגלית).

ענה רק ב-JSON הזה, בלי טקסט ובלי גדר markdown:
{"summary": טקסט, "checks": [{"seq": מספר, "passed": כן/לא, "detail": טקסט, "likelyCause": "implementation"|"requirement_ambiguity"|"dependency_missing"|"environment"|null}]}$p$
) ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint

-- The development run no longer reports checks: it writes the code and the
-- tests for it, and the checks run after it, separately, without write access.
-- Replaced whole only where no person has edited it; an edited one is left as
-- it is, and the Prompts screen names what in it no longer fits.
UPDATE "prompt_template" SET
  "description" = 'רץ כשלוחצים "פתח" על משימה מאושרת. קלוד עובד בעותק נפרד של המאגר, בענף של המשימה: משנה קוד וכותב בדיקות להיגיון שהוסיף. אחריו DCC בונה ומריץ את הבדיקות בשלבים נפרדים (הפרומפט "הרצת הבדיקות של משימה"). ההוראה של המשימה עצמה ({{INSTRUCTION}}) נכתבת ונערכת במשימה, לא כאן.',
  "body" = $p$You are implementing ONE task in this repository. You are on a fresh branch; the working tree is clean.

TASK — this is the instruction, follow it exactly:
{{INSTRUCTION}}
{{#SHORT_TITLE}}
(short title: {{SHORT_TITLE}})
{{/SHORT_TITLE}}{{#AFFECTED_PATHS}}
Files the breakdown expected to change: {{AFFECTED_PATHS}}
{{/AFFECTED_PATHS}}Appetite: {{APPETITE}}
{{#BUILT_ON}}
BUILT ON — this branch starts from the branch of a task this one depends on, which is not in the default branch yet: {{BUILT_ON}}. That work is already here: build on it, do not redo it.
{{/BUILT_ON}}{{#MISSING}}
NOT HERE YET — this task depends on work that is not in this branch: {{MISSING}}. Build everything you can against the code as it is. Where you need that work, write against the shape it will most likely have, keep each such assumption small and obvious, and name every one in "followUps" so the task can be revisited once that work exists.
{{/MISSING}}
CONTEXT — the requirement this task came from (Hebrew):
{{CONTEXT}}

Do this:
1. Read the relevant code before changing anything. Match the surrounding style exactly.
2. Make the change. Keep it to THIS task — do not refactor beyond it, do not touch unrelated files.
3. Tests: add tests for the logic you added or changed, in the repository's own test framework and next to its existing tests, and run them. Cover the behaviour the task asks for and the cases around it. If the repository has no tests or no way to run them, add none and say so in "followUps".
4. Do not install dependencies. Do NOT commit, do NOT push, do NOT create branches — that is handled outside.
5. Blast radius: for EACH file you changed, search the rest of the repository (grep/glob — do not guess) for other files that
   import, call, extend, instantiate, or register it (e.g. other plugins that call a shared BL class, other webresources that
   load a shared JS module, other configs that reference it). This tells the user what else must be packaged/retested together
   with this change. If a changed file has no other consumers, omit it from this list — do not pad it with unrelated files.

After you, DCC builds the change and runs its checks — the build, the tests, regression — as separate steps. Do not report them here.

IMPORTANT: write `summary`, `followUps` and every `reason` IN HEBREW (code identifiers and paths stay English).

Respond with ONLY this JSON, no prose, no markdown fence:
{"summary": string, "filesChanged": string[], "testsRun": string|null, "followUps": string[], "affectedConsumers": [{"path": string, "usedBy": string[], "reason": string}]}$p$,
  "body_he" = $p$אתה מממש משימה אחת במאגר הזה. אתה על ענף חדש; תיקיית העבודה נקייה.

המשימה — זו ההוראה, בצע אותה בדיוק:
{{INSTRUCTION}}
{{#SHORT_TITLE}}
(כותרת קצרה: {{SHORT_TITLE}})
{{/SHORT_TITLE}}{{#AFFECTED_PATHS}}
הקבצים שהפירוק צפה שישתנו: {{AFFECTED_PATHS}}
{{/AFFECTED_PATHS}}היקף: {{APPETITE}}
{{#BUILT_ON}}
בנוי על — הענף הזה מתחיל מהענף של משימה שהמשימה הזו תלויה בה, ושעוד לא נכנסה לענף הראשי: {{BUILT_ON}}. העבודה שלה כבר כאן: בנה עליה, אל תעשה אותה שוב.
{{/BUILT_ON}}{{#MISSING}}
עוד לא כאן — המשימה הזו תלויה בעבודה שלא נמצאת בענף הזה: {{MISSING}}. בנה כל מה שאפשר מול הקוד כפי שהוא. איפה שאתה צריך את העבודה ההיא, כתוב מול הצורה שהיא כנראה תקבל, שמור כל הנחה כזו קטנה וברורה, ופרט כל אחת ב-"followUps" כדי שאפשר יהיה לחזור למשימה כשהעבודה ההיא תהיה קיימת.
{{/MISSING}}
הקשר — הדרישה שהמשימה הזו באה ממנה:
{{CONTEXT}}

בצע:
1. קרא את הקוד הרלוונטי לפני שאתה משנה משהו. התאם בדיוק לסגנון שמסביב.
2. בצע את השינוי. רק המשימה הזו — בלי refactor מעבר לה, בלי לגעת בקבצים לא קשורים.
3. בדיקות: הוסף בדיקות להיגיון שהוספת או שינית, במסגרת הבדיקות של המאגר עצמו וליד הבדיקות הקיימות שלו, והרץ אותן. כסה את ההתנהגות שהמשימה מבקשת ואת המקרים סביבה. אם במאגר אין בדיקות או אין דרך להריץ אותן — אל תוסיף, ואמור את זה ב-"followUps".
4. אל תתקין תלויות. אל תעשה commit, אל תעשה push, אל תיצור ענפים — זה מטופל מבחוץ.
5. רדיוס פגיעה: לכל קובץ ששינית, חפש בשאר המאגר (grep/glob — לא לנחש) קבצים אחרים שמייבאים, קוראים, יורשים, יוצרים או רושמים אותו (למשל plugins אחרים שקוראים למחלקת BL משותפת, webresources אחרים שטוענים מודול JS משותף, קונפיגורציות שמפנות אליו). זה אומר למשתמש מה עוד צריך לארוז ולבדוק מחדש יחד עם השינוי. אם לקובץ שהשתנה אין צרכנים אחרים, השמט אותו מהרשימה — אל תנפח אותה בקבצים לא קשורים.

אחריך DCC בונה את השינוי ומריץ את הבדיקות שלו — build, בדיקות, רגרסיה — בשלבים נפרדים. אל תדווח עליהן כאן.

חשוב: כתוב את summary, את followUps ואת כל reason בעברית (שמות בקוד ונתיבים נשארים באנגלית).

ענה רק ב-JSON הזה, בלי טקסט ובלי גדר markdown:
{"summary": טקסט, "filesChanged": רשימה, "testsRun": טקסט|null, "followUps": רשימה, "affectedConsumers": [{"path": טקסט, "usedBy": רשימה, "reason": טקסט}]}$p$
WHERE "key" = 'implement.task' AND "updated_by" IS NULL;
--> statement-breakpoint

-- A check run on its own is now "checks.run" with one check.
DELETE FROM "prompt_template" WHERE "key" = 'implement.check';
--> statement-breakpoint

-- The breakdown no longer proposes what DCC adds by itself.
UPDATE "prompt_template" SET
  "body" = replace("body",
    $a$did, rather than to make its own code change.$a$,
    $b$did, rather than to make its own code change.
DCC itself adds a build check, a tests check and a regression check under every leaf task — do not propose those. Propose a check only for what they do not cover: a specific behaviour to verify, documentation, data to confirm.$b$),
  "body_he" = replace("body_he",
    $a$ולא לבצע שינוי קוד משלו.$a$,
    $b$ולא לבצע שינוי קוד משלו.
DCC עצמו מוסיף בדיקת build, בדיקות לפיתוח ובדיקות רגרסיה תחת כל משימה שהיא עלה — אל תציע אותן. הצע בדיקה רק למה שהן לא מכסות: התנהגות מסוימת לאמת, תיעוד, נתונים לאשר.$b$)
WHERE "key" = 'breakdown.tasks';
