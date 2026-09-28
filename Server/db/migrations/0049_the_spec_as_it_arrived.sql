-- 0049 — the specification is shown as it arrived.
--
-- The document is read straight out of the attached file — its own
-- headings, paragraphs and tables, with an id on every row, cell and line
-- (`spec-doc.ts`) — and kept here as it was read. The model no longer cuts
-- the document into pieces of its own wording; it only says which of the
-- document's pieces are requirements, which task implements each, and where
-- a closed decision overrules the words. `spec_section` becomes just that
-- list of requirements, and loses what only a model-cut document needed.
CREATE TABLE IF NOT EXISTS "spec_document" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "client_id" uuid NOT NULL REFERENCES "client"("id") ON DELETE cascade,
  "workitem_id" uuid NOT NULL REFERENCES "workitem"("id") ON DELETE cascade,
  "attachment_id" uuid REFERENCES "attachment"("id") ON DELETE set null,
  "doc" jsonb NOT NULL,
  "corrections" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "spec_document_workitem_idx" ON "spec_document" ("workitem_id");
--> statement-breakpoint
ALTER TABLE "spec_document" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "spec_document_tenant_isolation" ON "spec_document" AS PERMISSIVE FOR ALL TO public
  USING ("client_id" = current_setting('app.current_client', true)::uuid)
  WITH CHECK ("client_id" = current_setting('app.current_client', true)::uuid);
--> statement-breakpoint

-- A reading made the old way pointed at pieces of the model's own wording,
-- which no longer exist to be drawn. It is derived data: the requirement's
-- "קרא את האפיון" reads the document again in the new shape.
DELETE FROM "task_spec_link";
--> statement-breakpoint
DELETE FROM "spec_section";
--> statement-breakpoint
ALTER TABLE "spec_section" DROP COLUMN IF EXISTS "parent_anchor";
--> statement-breakpoint
ALTER TABLE "spec_section" DROP COLUMN IF EXISTS "corrected_by_gap_id";
--> statement-breakpoint
ALTER TABLE "spec_section" DROP COLUMN IF EXISTS "correction";
--> statement-breakpoint

UPDATE "prompt_template" SET
  "title" = 'סימון הדרישות באפיון',
  "description" = 'רץ פעם אחת על דרישה, כשלוחצים "קרא את האפיון" במסך הדרישה. המסמך עצמו כבר מוצג כמו שהגיע — הכותרות, הפסקאות והטבלאות שלו, עם מזהה על כל שורה, תא ושורת טקסט. קלוד רק מסמן אילו מהחלקים האלה הם דרישות, איזו משימה מממשת כל אחת, והיכן החלטה שנסגרה גוברת על מילים במסמך. הוא לא כותב מחדש אף מילה של האפיון. את שמות השדות בתשובה (requirements, links, corrections, id, ids) הקוד קורא — הם חייבים להישאר.',
  "body" = $p$Mark which pieces of this requirement's specification are requirements, and say which task implements each. Read only — the document is shown to people exactly as it arrived, and you never rewrite it.

REQUIREMENT: {{TITLE}}

THE SPECIFICATION, as it arrived in {{DOC_NAME}}. Every piece carries its id in brackets — a heading, a paragraph and its lines, a table, each row, each cell, and each line of a cell that has several:
{{SPEC}}

DECISIONS closed on this requirement — each is a question that was asked and the answer that settled it, with its id:
{{DECISIONS}}

THE TASKS the requirement was broken into, by seq:
{{TASKS}}

Return ONE JSON object:

{"requirements": [...], "links": [...], "corrections": [...]}

`requirements` — every piece of the document that states something that has to be built or has to hold, in the document's order:
  {"id": "t1.r2.c6", "title": "היסטוריית ביקורת על בקשת נציג לביטול טופס"}
  - `id` — one of the ids above, exactly as written. Never a heading, never a whole table.
  - Point at the smallest piece that states ONE thing a task could implement: a single line of logic, one allowed value, one cell such as audit history = yes. Point at a whole row only when the whole row is one thing, such as a field that simply has to exist.
  - A field's own stated requirements are requirements of their own — audit history on, a maximum length, a default, becoming mandatory under a condition — so that one nobody implemented can be seen.
  - Leave out what states nothing: row numbers, change-tracking numbers, "סוף אם", a line that only opens a condition whose actions are listed on the lines below it.
  - `title` — a short name in the document's language, so the piece can be listed away from the document. A label, not a restatement.

`links` — which task implements which pieces: [{"seq": 7, "ids": ["t3.r1.c4.l3", "t3.r1.c4.l4"]}]
  - An id here is one of your `requirements`, or a decision's id.
  - Judge from what the task's own instruction says it does. A task may implement several pieces; a piece may need several tasks.
  - A task that implements nothing in the document (infrastructure, a checking task) does not appear.
  - Link a decision to the task that carries out what the decision settled.
  - Leave a piece unlinked when no task covers it. That gap is the most valuable thing this answer produces — never invent a link to make the spec look covered.

`corrections` — where a decision overrules the document's own words: [{"id": "t3.r1.c4.l7", "decision": "d.dc08a39c", "from": "[בקרת הצטרפות]", "to": "[בקרת מנהל]"}]
  - `id` — the smallest piece that holds the words. `from` — the exact words in it that no longer hold, copied character for character. `to` — what holds instead, in a few words.
  - Only where the decision genuinely contradicts the document. A decision that merely adds detail is not a correction.

Answer with the JSON object and nothing else.$p$,
  "body_he" = $p$סמן אילו חלקים באפיון של הדרישה הזו הם דרישות, ואמור איזו משימה מממשת כל אחת. קריאה בלבד — המסמך מוצג לאנשים בדיוק כמו שהגיע, ואתה לא משכתב אותו.

הדרישה: {{TITLE}}

האפיון, כמו שהגיע בקובץ {{DOC_NAME}}. לכל חלק יש מזהה בסוגריים — כותרת, פסקה ושורותיה, טבלה, כל שורה בה, כל תא, וכל שורת טקסט בתא שיש בו כמה:
{{SPEC}}

החלטות שנסגרו על הדרישה — כל אחת היא שאלה שנשאלה והתשובה שסגרה אותה, עם המזהה שלה:
{{DECISIONS}}

המשימות שהדרישה פורקה אליהן, לפי seq:
{{TASKS}}

החזר אובייקט JSON אחד:

{"requirements": [...], "links": [...], "corrections": [...]}

requirements — כל חלק במסמך שאומר משהו שצריך לבנות או שצריך להתקיים, בסדר של המסמך:
  {"id": "t1.r2.c6", "title": "היסטוריית ביקורת על בקשת נציג לביטול טופס"}
  - id — אחד מהמזהים למעלה, בדיוק כמו שנכתב. לא כותרת, ולא טבלה שלמה.
  - הצבע על החלק הקטן ביותר שאומר דבר אחד שמשימה יכולה לממש: שורת לוגיקה אחת, ערך מותר אחד, תא אחד כמו היסטוריית ביקורת = כן. שורה שלמה רק כשכל השורה היא דבר אחד, כמו שדה שפשוט צריך להתקיים.
  - הדרישות של שדה עצמו הן דרישות בפני עצמן — היסטוריית ביקורת, אורך מקסימלי, ברירת מחדל, חובה בתנאי — כדי שאחת שאף אחד לא מימש תיראה.
  - השאר בחוץ את מה שלא אומר כלום: מספרי שורה, מספרי מעקב שינויים, "סוף אם", שורה שרק פותחת תנאי שהפעולות שלו רשומות בשורות שמתחתיה.
  - title — שם קצר בשפת המסמך, כדי שאפשר יהיה להציג את החלק גם מחוץ למסמך. תווית, לא ניסוח מחדש.

links — איזו משימה מממשת אילו חלקים: [{"seq": 7, "ids": ["t3.r1.c4.l3", "t3.r1.c4.l4"]}]
  - מזהה כאן הוא אחד מה-requirements שלך, או מזהה של החלטה.
  - שפוט לפי מה שההוראה של המשימה עצמה אומרת שהיא עושה. משימה יכולה לממש כמה חלקים; חלק יכול לדרוש כמה משימות.
  - משימה שלא מממשת שום דבר במסמך (תשתית, משימת בדיקה) לא מופיעה.
  - קשר החלטה למשימה שמבצעת את מה שההחלטה קבעה.
  - השאר חלק בלי קישור כשאף משימה לא מכסה אותו. הפער הזה הוא הדבר הכי שימושי בתשובה — לעולם אל תמציא קישור כדי שהאפיון ייראה מכוסה.

corrections — היכן שהחלטה גוברת על המילים של המסמך: [{"id": "t3.r1.c4.l7", "decision": "d.dc08a39c", "from": "[בקרת הצטרפות]", "to": "[בקרת מנהל]"}]
  - id — החלק הקטן ביותר שמחזיק את המילים. from — המילים המדויקות בו שכבר לא תקפות, מועתקות תו אחר תו. to — מה שתקף במקומן, בכמה מילים.
  - רק היכן שההחלטה באמת סותרת את המסמך. החלטה שרק מוסיפה פירוט אינה תיקון.

ענה באובייקט ה-JSON ותו לא.$p$
WHERE "key" = 'spec.map' AND "updated_by" IS NULL;
