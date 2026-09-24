-- 0050 — a link between a task and a requirement has to prove itself.
--
-- The first reading in the new shape linked audit history on both new fields
-- to the task that creates the fields, though that task's instruction never
-- mentions audit history — and so hid the one real gap the spec had. A link
-- now quotes the words in the task's own instruction that say it, the code
-- checks the quote, and a link whose words are not there is dropped: the
-- requirement then shows as the gap it is. The instruction is also sent
-- whole; it used to be cut at 500 characters.
UPDATE "prompt_template" SET
  "description" = 'רץ פעם אחת על דרישה, כשלוחצים "סמן את הדרישות" במפת הדרישה. המסמך עצמו כבר מוצג כמו שהגיע — הכותרות, הפסקאות והטבלאות שלו, עם מזהה על כל שורה, תא ושורת טקסט. קלוד רק מסמן אילו מהחלקים האלה הם דרישות, איזו משימה מממשת כל אחת — עם ציטוט מההוראה של המשימה שאומר זאת, שהקוד בודק — והיכן החלטה שנסגרה גוברת על מילים במסמך. הוא לא כותב מחדש אף מילה של האפיון. את שמות השדות בתשובה (requirements, links, corrections, id, evidence) הקוד קורא — הם חייבים להישאר.',
  "body" = $p$Mark which pieces of this requirement's specification are requirements, and say which task implements each. Read only — the document is shown to people exactly as it arrived, and you never rewrite it.

REQUIREMENT: {{TITLE}}

THE SPECIFICATION, as it arrived in {{DOC_NAME}}. Every piece carries its id in brackets — a heading, a paragraph and its lines, a table, each row, each cell, and each line of a cell that has several:
{{SPEC}}

DECISIONS closed on this requirement — each is a question that was asked and the answer that settled it, with its id:
{{DECISIONS}}

THE TASKS the requirement was broken into, by seq — each with its whole instruction:
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

`links` — one entry for every task-and-piece pair: [{"seq": 7, "id": "t3.r1.c4.l3", "evidence": "..."}]
  - `id` — one of your `requirements`, or a decision's id.
  - `evidence` — the words in THAT task's own instruction above that say it does this, copied exactly: a phrase, not a single word. The quote is checked against the instruction, and a link whose words are not there is thrown away.
  - A task implements what its instruction says, and nothing more. Creating a field does NOT implement its audit history, its default, its maximum length or its being mandatory unless the instruction says that property — those are exactly the requirements that get lost, and this reading exists to find them.
  - A task may implement several pieces; a piece may need several tasks. A task that implements nothing in the document (infrastructure, a checking task) does not appear.
  - Link a decision to the task whose instruction carries out what the decision settled.
  - When no task's instruction says it, leave the piece unlinked. That gap is the most valuable thing this answer produces — never invent a link to make the spec look covered.

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

המשימות שהדרישה פורקה אליהן, לפי seq — כל אחת עם ההוראה המלאה שלה:
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

links — רשומה אחת לכל זוג של משימה וחלק: [{"seq": 7, "id": "t3.r1.c4.l3", "evidence": "..."}]
  - id — אחד מה-requirements שלך, או מזהה של החלטה.
  - evidence — המילים בהוראה של המשימה הזו עצמה, למעלה, שאומרות שהיא עושה את זה, מועתקות בדיוק: ביטוי, לא מילה בודדת. הציטוט נבדק מול ההוראה, וקישור שהמילים שלו לא שם — נזרק.
  - משימה מממשת את מה שההוראה שלה אומרת, ולא יותר. הקמת שדה אינה מממשת את היסטוריית הביקורת שלו, את ברירת המחדל, את האורך המקסימלי או את היותו חובה — אלא אם ההוראה אומרת את התכונה הזו. אלה בדיוק הדרישות שהולכות לאיבוד, והקריאה הזו קיימת כדי למצוא אותן.
  - משימה יכולה לממש כמה חלקים; חלק יכול לדרוש כמה משימות. משימה שלא מממשת שום דבר במסמך (תשתית, משימת בדיקה) לא מופיעה.
  - קשר החלטה למשימה שההוראה שלה מבצעת את מה שההחלטה קבעה.
  - כשההוראה של אף משימה לא אומרת את זה, השאר את החלק בלי קישור. הפער הזה הוא הדבר הכי שימושי בתשובה — לעולם אל תמציא קישור כדי שהאפיון ייראה מכוסה.

corrections — היכן שהחלטה גוברת על המילים של המסמך: [{"id": "t3.r1.c4.l7", "decision": "d.dc08a39c", "from": "[בקרת הצטרפות]", "to": "[בקרת מנהל]"}]
  - id — החלק הקטן ביותר שמחזיק את המילים. from — המילים המדויקות בו שכבר לא תקפות, מועתקות תו אחר תו. to — מה שתקף במקומן, בכמה מילים.
  - רק היכן שההחלטה באמת סותרת את המסמך. החלטה שרק מוסיפה פירוט אינה תיקון.

ענה באובייקט ה-JSON ותו לא.$p$
WHERE "key" = 'spec.map' AND "updated_by" IS NULL;
