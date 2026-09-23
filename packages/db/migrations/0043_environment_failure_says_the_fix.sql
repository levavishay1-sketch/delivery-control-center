-- 0043 — an "environment" check failure must name the fix, not only the
-- diagnosis: DCC's own task-status.ts reason line is a fixed sentence
-- ("אי אפשר לבנות כאן — חסר כלי או SDK"); what a person actually needs is
-- what Claude found missing AND what to do about it. Replaced whole only
-- where no person has edited it; an edited one is left as it is.
UPDATE "prompt_template" SET
  "body" = $p$You are VERIFYING a change in this repository — the work of one task, already made and committed on this branch. You may read code and run commands (a build, tests). You must NOT change, create or delete any file, and must not commit: a check that changes code proves nothing. Build outputs that the build itself writes are fine.

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
- "environment" — it could not run here (a missing SDK, tool, service or credentials). Say exactly what is missing, AND the concrete action that would fix it — what to install, what to configure, what command to run. A person reads "detail" to decide what to do next: never leave it as only a diagnosis.

IMPORTANT: write every "detail" and the "summary" IN HEBREW (code identifiers, commands and paths stay English).

Respond with ONLY this JSON, no prose, no markdown fence:
{"summary": string, "checks": [{"seq": number, "passed": boolean, "detail": string, "likelyCause": "implementation"|"requirement_ambiguity"|"dependency_missing"|"environment"|null}]}$p$,
  "body_he" = $p$אתה מאמת שינוי במאגר הזה — העבודה של משימה אחת, שכבר נעשתה ונשמרה ב-commit בענף הזה. מותר לקרוא קוד ולהריץ פקודות (build, בדיקות). אסור לשנות, ליצור או למחוק שום קובץ, ואסור לעשות commit: בדיקה שמשנה קוד לא מוכיחה כלום. תוצרים שה-build עצמו כותב — בסדר.

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
- "environment" — אי אפשר היה להריץ אותה כאן (SDK, כלי, שירות או הרשאות חסרים). אמור בדיוק מה חסר, ואת הפעולה הקונקרטית שתפתור את זה — מה להתקין, מה להגדיר, איזו פקודה להריץ. מי שקורא את "detail" מחליט לפיו מה לעשות הלאה: אל תשאיר אותו רק אבחנה.

חשוב: כתוב כל "detail" ואת ה-"summary" בעברית (שמות בקוד, פקודות ונתיבים נשארים באנגלית).

ענה רק ב-JSON הזה, בלי טקסט ובלי גדר markdown:
{"summary": טקסט, "checks": [{"seq": מספר, "passed": כן/לא, "detail": טקסט, "likelyCause": "implementation"|"requirement_ambiguity"|"dependency_missing"|"environment"|null}]}$p$
WHERE "key" = 'checks.run' AND "updated_by" IS NULL;
