-- 0022 — the gaps stage becomes the real gate.
--
-- 1. A gap stops being a line of prose and becomes an answerable QUESTION:
--    who can answer it (client vs team), what kind of decision it is,
--    candidate answers to click, and what breaks if we guess wrong.
-- 2. All five readiness tiers lose their own output contract; a single
--    shared "assess.shared.output_contract" template is appended to
--    whichever tier runs, so the answer's SHAPE (short bullets, plain
--    Hebrew, one idea per line) is authored once and fixes all of them.
-- 3. A new cheap (haiku) template composes the open gaps into a business
--    letter to the requirement's requester — no code, no jargon.
ALTER TABLE "gap" ADD COLUMN IF NOT EXISTS "why" text;--> statement-breakpoint
ALTER TABLE "gap" ADD COLUMN IF NOT EXISTS "kind" text NOT NULL DEFAULT 'missing_info';--> statement-breakpoint
ALTER TABLE "gap" ADD COLUMN IF NOT EXISTS "who_answers" text NOT NULL DEFAULT 'team';--> statement-breakpoint
ALTER TABLE "gap" ADD COLUMN IF NOT EXISTS "options" jsonb NOT NULL DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "gap" ADD COLUMN IF NOT EXISTS "impact_if_wrong" text;--> statement-breakpoint

INSERT INTO "prompt_template" ("key", "title", "description", "default_model", "sort_order", "body", "body_he") VALUES
(
  'assess.shared.output_contract',
  'פורמט התשובה (משותף לכל בחינות הבשלות)',
  'נוסף אוטומטית לכל אחת מ-5 רמות הבחינה. קובע איך התשובה נראית למשתמש — שינוי כאן משנה את כולן.',
  NULL,
  0,
  'OUTPUT — a person reads this, not a machine. Optimise for a busy reader who does not know this system:

- Plain Hebrew. Short lines. ONE idea per line. Never write a paragraph longer than two sentences.
- Do not bury code identifiers inside a sentence. If the reader must find a specific file or method, put it at the END of the line, on its own.
- Say what CHANGES for the user or the business, not how the code is organised.
- Every gap must be phrased as a QUESTION a person can actually answer — not an observation like "it is unclear whether...". Ask it: "האם ...?", "מה צריך לקרות כאשר ...?".
- For each gap decide honestly WHO can answer it: "client" = only the person who asked for this requirement can decide (a business/product decision), "team" = we can decide it ourselves from the code or our own standards.
- Where the code or context implies concrete candidate answers, list them in "options" (up to 3, one short line each) so the reader can pick instead of writing.
- "impactIfWrong": one short line — what actually breaks if we guess and guess wrong. This is how the reader judges urgency.

Respond with ONLY this JSON, no prose, no markdown fence:
{
  "title": string,
  "summary": string,
  "whatChanges": string[],
  "baked": boolean,
  "rationale": string[],
  "gaps": [{
    "question": string,
    "why": string,
    "kind": "business" | "technical" | "missing_info" | "new_scope",
    "whoAnswers": "client" | "team",
    "options": string[],
    "impactIfWrong": string,
    "blocking": boolean,
    "confidence": number
  }]
}

Field rules:
- "title": one short line.
- "summary": 1-2 short sentences, business language — what will change.
- "whatChanges": 2-5 bullets, each ONE short concrete line.
- "rationale": 2-4 bullets, each ONE short line, each a separate reason. Not a paragraph.
- "why": one short line per gap — why this matters.
- All strings in Hebrew (file paths and code identifiers stay English).',
  'פלט — בן אדם קורא את זה, לא מכונה. כתוב עבור קורא עסוק שלא מכיר את המערכת:

- עברית פשוטה. שורות קצרות. רעיון אחד בשורה. אף פעם לא פסקה של יותר משני משפטים.
- אל תקבור שמות מחלקות/מתודות באמצע משפט. אם הקורא צריך למצוא קובץ או מתודה ספציפית — שים אותם בסוף השורה, לבד.
- תאר מה משתנה עבור המשתמש או העסק, לא איך הקוד מסודר.
- כל פער חייב להיות מנוסח כשאלה שאפשר לענות עליה — לא אמירה כמו "לא ברור אם...". תשאל: "האם ...?", "מה צריך לקרות כאשר ...?".
- לכל פער תחליט בכנות מי יכול לענות: "client" = רק מי שביקש את הדרישה יכול להכריע (החלטה עסקית), "team" = אנחנו יכולים להחליט לבד מהקוד או מהסטנדרטים שלנו.
- כשהקוד או ההקשר מרמזים על תשובות אפשריות — פרט אותן ב-options (עד 3, שורה קצרה כל אחת) כדי שהקורא יבחר במקום לכתוב.
- impactIfWrong: שורה אחת — מה באמת נשבר אם ננחש לא נכון. לפי זה הקורא שופט דחיפות.

השב אך ורק ב-JSON, בלי טקסט נוסף.

כללי שדות:
- title: שורה קצרה אחת.
- summary: 1-2 משפטים קצרים בשפה עסקית — מה ישתנה.
- whatChanges: 2-5 בולטים, שורה קצרה וקונקרטית כל אחד.
- rationale: 2-4 בולטים, שורה אחת כל אחד, כל אחד נימוק נפרד. לא פסקה.
- why: שורה קצרה לכל פער — למה זה משנה.
- כל המחרוזות בעברית (נתיבי קבצים ושמות בקוד נשארים באנגלית).'
),
(
  'gaps.client_letter',
  'ניסוח פערים למבקש הדרישה',
  'הופך את הפערים הפתוחים למכתב בשפה עסקית שאפשר לשלוח ללקוח. רץ במודל הזול.',
  'haiku',
  10,
  'You are writing to the BUSINESS PERSON who asked for this requirement — a client-side manager, not a developer. They did not read the code and never will.

Write a short, polite Hebrew message that says: we reviewed the requirement, we cannot start yet, and these are the questions we need answered.

Hard rules:
- No code. No file names, no method names, no class names, no technical jargon. If a question only makes sense in code terms, rephrase it in terms of what the USER of the system would see or experience.
- Short lines. Number the questions. One question per number.
- Where candidate answers exist, offer them as options so they can just pick one.
- Do not invent questions that are not in the list. Do not soften a question into vagueness.
- Do not apologise repeatedly. One polite opening, the questions, one short closing line saying work continues as soon as answers arrive.
- Keep the whole message under about 200 words.

THE REQUIREMENT (as it was given to us):
{{REQUIREMENT_TITLE}}
{{REQUIREMENT_TEXT}}

THE OPEN QUESTIONS (internal phrasing — rewrite them for a business reader):
{{GAPS}}

Respond with ONLY this JSON, no prose, no markdown fence:
{"subject": string, "body": string}

Both values in Hebrew. "subject" is one short line. "body" is the message text, with real line breaks.',
  'אתה כותב לאיש העסקים שביקש את הדרישה — מנהל מצד הלקוח, לא מפתח. הוא לא קרא את הקוד ולא יקרא.

כתוב הודעה קצרה ומנומסת בעברית שאומרת: בדקנו את הדרישה, אנחנו לא יכולים להתחיל עדיין, ואלה השאלות שצריך לענות עליהן.

כללים נוקשים:
- בלי קוד. בלי שמות קבצים, מתודות או מחלקות, בלי ז''רגון טכני. אם שאלה מובנת רק במונחי קוד — נסח אותה מחדש במונחים של מה שהמשתמש במערכת יראה או יחווה.
- שורות קצרות. מספר את השאלות. שאלה אחת למספר.
- כשיש תשובות אפשריות — הצע אותן כאפשרויות לבחירה.
- אל תמציא שאלות שלא ברשימה. אל תרכך שאלה לעמימות.
- אל תתנצל שוב ושוב. פתיחה מנומסת אחת, השאלות, ושורת סיום קצרה שאומרת שהעבודה תימשך ברגע שיתקבלו תשובות.
- כל ההודעה עד כ-200 מילים.

הדרישה (כפי שנמסרה לנו):
{{REQUIREMENT_TITLE}}
{{REQUIREMENT_TEXT}}

השאלות הפתוחות (ניסוח פנימי — נסח אותן מחדש לקורא עסקי):
{{GAPS}}

השב אך ורק ב-JSON: {"subject": string, "body": string} — שניהם בעברית.'
)
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint

-- each tier now describes only its own FOCUS and depth; the output shape
-- comes from assess.shared.output_contract, appended at run time.
UPDATE "prompt_template" SET "body" = 'You are doing a FAST triage of a software requirement''s readiness — a quick sanity check, not a full review. Spend minimal effort: catch only what obviously blocks starting work. Do not analyse deeply, do not explain process, do not speculate about edge cases.

{{REPO_CONTEXT}}

REQUIREMENT:
{{REQUIREMENT}}

Do this, briefly:
1. Restate what is being asked — one short title, 1-2 short sentences.
2. Decide "baked": true only if a developer could clearly start today.
3. Raise ONLY questions that block starting — usually 0-2. Skip anything minor.
4. Keep every line short. This tier exists to be read in thirty seconds.',
"body_he" = 'אתה מבצע טריאז'' מהיר לבשלות של דרישת תוכנה — בדיקת שפיות זריזה, לא בדיקה מלאה. השקע מאמץ מינימלי: תפוס רק מה שחוסם באופן מובהק התחלת עבודה. אל תנתח לעומק, אל תסביר תהליכים, אל תשער לגבי מקרי קצה.

{{REPO_CONTEXT}}

הדרישה:
{{REQUIREMENT}}

בצע בקצרה:
1. נסח מחדש מה מבוקש — כותרת קצרה ו-1-2 משפטים קצרים.
2. קבע "אפויה": true רק אם מפתח יכול להתחיל היום בבירור.
3. העלה רק שאלות שחוסמות התחלה — בדרך כלל 0-2. דלג על כל דבר משני.
4. שמור על שורות קצרות. הרמה הזו קיימת כדי להיקרא בשלושים שניות.'
WHERE "key" = 'assess.readiness.quick';--> statement-breakpoint

UPDATE "prompt_template" SET "body" = 'You are assessing a software requirement''s READINESS for a delivery team — a "Definition of Ready" check, not a code review and not an implementation. This is a STANDARD-depth pass: balance speed and depth. Judge whether the requirement is specified clearly enough that a developer (or an AI coding agent) could start without guessing.

Ground your judgment in these criteria (INVEST / Definition-of-Ready):
- Clarity: could two people read this and build different things?
- Scope: is it bounded — a specific change, not an open-ended direction?
- Testability: is there a way to tell the change worked?
- Dependencies: does it wait on a decision, another change, or data that is not resolved?
- Feasibility: does anything here conflict with how the code already works, or reference something that does not exist?

{{REPO_CONTEXT}}

REQUIREMENT:
{{REQUIREMENT}}

Do this:
1. Restate the requirement for someone with NO context on this system.
2. Decide if it is "baked", or if there are open questions a person must answer first.
3. Raise each open question, judging honestly whether only the client can answer it or we can decide it ourselves.',
"body_he" = 'אתה בוחן בשלות של דרישת תוכנה — בדיקת "Definition of Ready", לא code review ולא מימוש. זו בדיקה בעומק רגיל: איזון בין מהירות לעומק. שפוט אם הדרישה מוגדרת מספיק בבהירות כדי שמפתח (או סוכן AI) יתחיל בלי לנחש.

בסס על הקריטריונים (INVEST / Definition-of-Ready):
- בהירות: האם שני אנשים היו בונים דברים שונים מאותו טקסט?
- היקף: האם זה תחום — שינוי ספציפי ולא כיוון פתוח?
- ניתנת-לבדיקה: יש דרך לדעת שהשינוי הצליח?
- תלויות: האם זה ממתין להחלטה, לשינוי אחר או לנתון שלא נפתר?
- ישימות: האם משהו כאן סותר את איך שהקוד עובד היום, או מתייחס למשהו שלא קיים?

{{REPO_CONTEXT}}

הדרישה:
{{REQUIREMENT}}

בצע:
1. נסח מחדש את הדרישה עבור מישהו בלי שום הקשר על המערכת.
2. קבע אם היא אפויה, או שיש שאלות פתוחות שאדם חייב לענות עליהן קודם.
3. העלה כל שאלה פתוחה, ותשפוט בכנות אם רק הלקוח יכול לענות או שאנחנו יכולים להחליט לבד.'
WHERE "key" = 'assess.readiness.standard';--> statement-breakpoint

UPDATE "prompt_template" SET "body" = 'You are assessing a software requirement''s READINESS for a delivery team — a "Definition of Ready" check, not a code review and not an implementation. This is a THOROUGH pass: reason fully, including effects on other processes, non-obvious dependencies, and edge cases visible in the code. Depth of ANALYSIS is high here — but the written answer still has to be short and scannable.

Ground your judgment in: clarity, scope, testability, dependencies (trace them as far as is reasonable), feasibility against the real code, and downstream impact the requirement does not mention.

{{REPO_CONTEXT}}

REQUIREMENT:
{{REQUIREMENT}}

Do this:
1. Restate the requirement for someone with NO context, including why it matters.
2. Decide if it is "baked", or if there are open questions a person must answer first.
3. Raise each open question, judging honestly whether only the client can answer it or we can decide it ourselves.
4. Include anything you noticed in the code that the requirement does not mention but that the reader should know.',
"body_he" = 'אתה בוחן בשלות של דרישת תוכנה — בדיקת "Definition of Ready". זו בדיקה מעמיקה: נתח לעומק, כולל השפעות על תהליכים אחרים, תלויות לא מובנות מאליהן ומקרי קצה שנראים בקוד. עומק הניתוח גבוה — אבל התשובה הכתובה עדיין חייבת להיות קצרה וסרוקה בקלות.

בסס על: בהירות, היקף, ניתנות-לבדיקה, תלויות (עקוב אחריהן ככל שסביר), ישימות מול הקוד האמיתי, והשפעה על המשך שהדרישה לא מזכירה.

{{REPO_CONTEXT}}

הדרישה:
{{REQUIREMENT}}

בצע:
1. נסח מחדש את הדרישה עבור מישהו בלי הקשר, כולל למה זה משנה.
2. קבע אם היא אפויה, או שיש שאלות פתוחות שאדם חייב לענות עליהן קודם.
3. העלה כל שאלה פתוחה, ותשפוט בכנות מי יכול לענות עליה.
4. כלול כל דבר שראית בקוד שהדרישה לא מזכירה אבל הקורא צריך לדעת.'
WHERE "key" = 'assess.readiness.thorough';--> statement-breakpoint

UPDATE "prompt_template" SET "body" = 'You are conducting a rigorous AUDIT of a software requirement''s readiness — the most thorough tier, grounded in the IEEE 830 quality attributes. Treat this as a formal quality gate. Analyse deeply; write briefly.

Evaluate the requirement against EACH attribute, and every attribute that is NOT satisfied becomes an open question:
- Correct: does it reflect what is actually needed, as far as context shows?
- Unambiguous: does every part have exactly one interpretation?
- Complete: is anything essential missing — inputs, outputs, error cases, who triggers it?
- Consistent: does it contradict other notes, other code, other stated behaviour?
- Bounded: is scope clear, or could it balloon?
- Verifiable: is there a concrete way to prove the system satisfies it once built?
- Feasible: does it conflict with, or depend on, code that behaves differently than assumed?
- Traceable: can you connect it to a specific existing behaviour it changes?

{{REPO_CONTEXT}}

REQUIREMENT:
{{REQUIREMENT}}

Do this:
1. Restate the requirement precisely, for someone with zero context.
2. Decide "baked" only if no attribute fails in a way that blocks starting.
3. Raise each failed attribute as an open question, judging honestly who can answer it. Name the attribute in the question''s "why" line.',
"body_he" = 'אתה מבצע ביקורת קפדנית לבשלות של דרישת תוכנה — הרמה היסודית ביותר, מבוססת מאפייני האיכות של תקן IEEE 830. התייחס לזה כשער איכות פורמלי. נתח לעומק; כתוב בקצרה.

הערך את הדרישה מול כל מאפיין, וכל מאפיין שלא מתקיים הופך לשאלה פתוחה:
- נכונה: משקפת את מה שבאמת נדרש?
- חד-משמעית: לכל חלק יש פירוש אחד בלבד?
- שלמה: חסר משהו חיוני — קלט, פלט, מקרי שגיאה, מי מפעיל?
- עקבית: סותרת הערות אחרות, קוד אחר או התנהגות מוצהרת אחרת?
- תחומה: ההיקף ברור, או עלול לתפוח?
- ניתנת-לאימות: יש דרך קונקרטית להוכיח שהמערכת עומדת בה?
- ישימה: סותרת או תלויה בקוד שמתנהג אחרת ממה שהונח?
- ניתנת-למעקב: אפשר לקשר להתנהגות קיימת ספציפית שהיא משנה?

{{REPO_CONTEXT}}

הדרישה:
{{REQUIREMENT}}

בצע:
1. נסח מחדש את הדרישה במדויק, עבור מישהו בלי שום הקשר.
2. קבע "אפויה" רק אם אף מאפיין לא נכשל באופן שחוסם התחלה.
3. העלה כל מאפיין שנכשל כשאלה פתוחה, ותשפוט בכנות מי יכול לענות. ציין את שם המאפיין בשורת ה-why.'
WHERE "key" = 'assess.readiness.audit';--> statement-breakpoint

UPDATE "prompt_template" SET "body" = 'You are assessing a software requirement''s READINESS for a delivery team — a "Definition of Ready" check, not a code review and not an implementation. Judge whether it is specified clearly enough that a developer (or an AI coding agent) could start without guessing.

Ground your judgment in: clarity, scope, testability, dependencies, and feasibility against the real code.

ADDITIONAL FOCUS REQUESTED BY THE USER FOR THIS RUN — weigh this heavily, on top of the criteria above:
{{CUSTOM_EMPHASIS}}

{{REPO_CONTEXT}}

REQUIREMENT:
{{REQUIREMENT}}

Do this:
1. Restate the requirement for someone with NO context on this system.
2. Decide if it is "baked", or if there are open questions a person must answer first — including anything raised by the user''s focus above.
3. Raise each open question, judging honestly whether only the client can answer it or we can decide it ourselves.',
"body_he" = 'אתה בוחן בשלות של דרישת תוכנה — בדיקת "Definition of Ready". שפוט אם היא מוגדרת מספיק בבהירות כדי שמפתח (או סוכן AI) יתחיל בלי לנחש.

בסס על: בהירות, היקף, ניתנות-לבדיקה, תלויות וישימות מול הקוד האמיתי.

דגש נוסף שהמשתמש ביקש להרצה הזו — תן לו משקל גבוה, מעל הקריטריונים הרגילים:
{{CUSTOM_EMPHASIS}}

{{REPO_CONTEXT}}

הדרישה:
{{REQUIREMENT}}

בצע:
1. נסח מחדש את הדרישה עבור מישהו בלי שום הקשר על המערכת.
2. קבע אם היא אפויה, או שיש שאלות פתוחות — כולל כל מה שעלה מהדגש של המשתמש.
3. העלה כל שאלה פתוחה, ותשפוט בכנות מי יכול לענות עליה.'
WHERE "key" = 'assess.readiness.custom';
