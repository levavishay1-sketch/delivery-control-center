-- 0023 — two fixes surfaced by real use of the gaps stage:
--
-- 1. A resolved/dismissed gap's answer lived ONLY as freeform text buried
--    in a timeline note (verifyGap() wrote it there and nowhere else).
--    The "טופלו" list in the UI could show the question again but never
--    the answer without the reader going and searching the timeline for
--    it. Store the answer directly on the gap row too.
-- 2. The assess output let the model claim "baked": true in the same
--    breath as filing open gaps, because nothing tied the two together —
--    the reader would see "אפויה — מוכנה לפירוק" on the summary card and
--    2 unresolved questions on the Gaps tab. The DB-side rule cannot be
--    the whole fix (a bad model response can always slip through), so
--    runAssess() now also forces baked=false whenever gaps is non-empty;
--    this prompt change asks the model to keep the two consistent in the
--    first place, and to write "לא אפויה" reasoning that matches.
ALTER TABLE "gap" ADD COLUMN IF NOT EXISTS "answer" text;--> statement-breakpoint

UPDATE "prompt_template" SET "body" = 'OUTPUT — a person reads this, not a machine. Optimise for a busy reader who does not know this system:

- Plain Hebrew. Short lines. ONE idea per line. Never write a paragraph longer than two sentences.
- Do not bury code identifiers inside a sentence. If the reader must find a specific file or method, put it at the END of the line, on its own.
- Say what CHANGES for the user or the business, not how the code is organised.
- Every gap must be phrased as a QUESTION a person can actually answer — not an observation like "it is unclear whether...". Ask it: "האם ...?", "מה צריך לקרות כאשר ...?".
- For each gap decide honestly WHO can answer it: "client" = only the person who asked for this requirement can decide (a business/product decision), "team" = we can decide it ourselves from the code or our own standards.
- Where the code or context implies concrete candidate answers, list them in "options" (up to 3, one short line each) so the reader can pick instead of writing.
- "impactIfWrong": one short line — what actually breaks if we guess and guess wrong. This is how the reader judges urgency.
- "baked" must be false whenever "gaps" is non-empty — even one open question means the requirement is not ready to skip straight to breakdown. Only claim baked when there is truly nothing left to ask. Keep "rationale" consistent with this: do not write "no ambiguity" reasoning while also filing a gap.

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
"body_he" = 'פלט — בן אדם קורא את זה, לא מכונה. כתוב עבור קורא עסוק שלא מכיר את המערכת:

- עברית פשוטה. שורות קצרות. רעיון אחד בשורה. אף פעם לא פסקה של יותר משני משפטים.
- אל תקבור שמות מחלקות/מתודות באמצע משפט. אם הקורא צריך למצוא קובץ או מתודה ספציפית — שים אותם בסוף השורה, לבד.
- תאר מה משתנה עבור המשתמש או העסק, לא איך הקוד מסודר.
- כל פער חייב להיות מנוסח כשאלה שאפשר לענות עליה — לא אמירה כמו "לא ברור אם...". תשאל: "האם ...?", "מה צריך לקרות כאשר ...?".
- לכל פער תחליט בכנות מי יכול לענות: "client" = רק מי שביקש את הדרישה יכול להכריע (החלטה עסקית), "team" = אנחנו יכולים להחליט לבד מהקוד או מהסטנדרטים שלנו.
- כשהקוד או ההקשר מרמזים על תשובות אפשריות — פרט אותן ב-options (עד 3, שורה קצרה כל אחת) כדי שהקורא יבחר במקום לכתוב.
- impactIfWrong: שורה אחת — מה באמת נשבר אם ננחש לא נכון. לפי זה הקורא שופט דחיפות.
- "baked" חייב להיות false בכל פעם שיש ולו פער אחד ב-"gaps" — גם שאלה פתוחה אחת אומרת שהדרישה לא מוכנה לדלג ישר לפירוק. תטען "אפויה" רק כשבאמת אין יותר מה לשאול. שמור על "rationale" עקבי עם זה: אל תכתוב נימוק של "אין עמימות" ובאותה נשימה תגיש פער.

השב אך ורק ב-JSON, בלי טקסט נוסף.

כללי שדות:
- title: שורה קצרה אחת.
- summary: 1-2 משפטים קצרים בשפה עסקית — מה ישתנה.
- whatChanges: 2-5 בולטים, שורה קצרה וקונקרטית כל אחד.
- rationale: 2-4 בולטים, שורה אחת כל אחד, כל אחד נימוק נפרד. לא פסקה.
- why: שורה קצרה לכל פער — למה זה משנה.
- כל המחרוזות בעברית (נתיבי קבצים ושמות בקוד נשארים באנגלית).'
WHERE "key" = 'assess.shared.output_contract';
