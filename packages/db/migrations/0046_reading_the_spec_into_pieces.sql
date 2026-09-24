-- 0046 — the prompt that reads a requirement's spec into pieces a task can
-- point at. It runs once per requirement that was broken down before the
-- spec index existed; a breakdown from now on writes its own links.
--
-- It reads and maps only. It never rewrites the spec: a section keeps the
-- document's own words, and a decision that contradicts them is recorded
-- beside them as a correction.
INSERT INTO "prompt_template" ("key", "title", "description", "sort_order", "body", "body_he") VALUES (
'spec.map',
'קריאת האפיון לחלקים',
'רץ פעם אחת על דרישה, כשלוחצים "קרא את האפיון" במסך הדרישה. קלוד קורא את מסמך האפיון ואת ההחלטות שנסגרו, מפרק אותם לחלקים ממוענים (שדה, כלל, שורת מיפוי), ומסמן איזו משימה מממשת איזה חלק. הוא לא משנה את האפיון: החלק שומר את המילים של המסמך, והחלטה שסותרת אותן נרשמת לידן כתיקון. את שמות השדות בתשובה (anchor, sections, links) הקוד קורא — הם חייבים להישאר.',
2,
$p$Index this requirement's specification so each piece of it can be pointed at, and say which task implements which piece. Read only — do not rewrite the spec.

REQUIREMENT: {{TITLE}}

THE SPECIFICATION (as extracted from {{DOC_NAME}}; may be Hebrew, and a table may have flattened into consecutive lines):
{{SPEC}}

DECISIONS closed on this requirement — each is a question that was asked and the answer that settled it. Each already has its anchor, so a task can be linked to a decision exactly as to any other piece:
{{DECISIONS}}

THE TASKS the requirement was already broken into, by seq:
{{TASKS}}

Return ONE JSON object:

{"sections": [...], "links": [...], "corrections": [...]}

`sections` — the specification cut into the smallest pieces a single task could implement, in the document's own reading order:
  {"anchor": "f20", "kind": "field"|"rule"|"mapping"|"heading", "parentAnchor": "h1"|null, "title": "...", "body": "..."}
  - `anchor` — your own short id, letters/digits/dot/dash, unique in this answer. Keep it meaningful (f20 for field 20, r3a for the first bullet of rule 3) because it is what the links below point at.
  - `kind` — "field" a field the spec defines; "rule" one behaviour, one trigger; "mapping" one line of a source→target mapping; "heading" a section header that holds others (nothing implements a heading).
  - `title` — how the spec names it, in the spec's language. `body` — what it says, trimmed, still in the spec's words. NEVER your own restatement.
  - Cut a numbered rule with several bullets into one section per bullet when a different task could implement each; keep it whole when it is one act.
  - A field's stated requirements are their own sections when satisfying one is separate work: audit history on, a maximum length, becoming mandatory under a condition, a default. Put the field itself in one section and each such requirement in its own, so a requirement nobody implemented can be seen.
  - Do NOT create sections for the decisions. They are added by the system.

`links` — which task implements which pieces: [{"seq": 7, "anchors": ["r3a", "r3b"]}]
  - Judge from what the task's own instruction says it does, against the piece. A task may implement several pieces, and a piece may need several tasks.
  - A task that implements nothing in the document (infrastructure, a checking task) simply does not appear.
  - An anchor may be a decision's: link the task that carries out what the decision settled.
  - Leave a piece unlinked when no task covers it. That gap is the most valuable thing this answer produces — never invent a link to make the spec look covered.

`corrections` — where a decision overrules what the document says: [{"anchor": "r3e", "decision": 2, "correction": "בקרת מנהל"}]
  - `decision` is the number from the list above. `correction` is what holds instead, in a few words.
  - Only where the decision genuinely contradicts the document's words. A decision that merely adds detail is not a correction.

Answer with the JSON object and nothing else.$p$,
$p$בנה אינדקס לאפיון של הדרישה הזו, כך שאפשר יהיה להצביע על כל חלק בו, ואמור איזו משימה מממשת איזה חלק. קריאה בלבד — אל תשכתב את האפיון.

הדרישה: {{TITLE}}

האפיון (כפי שחולץ מתוך {{DOC_NAME}}; ייתכן שטבלה נשטחה לשורות רצופות):
{{SPEC}}

החלטות שנסגרו על הדרישה — כל אחת היא שאלה שנשאלה והתשובה שסגרה אותה. לכל אחת כבר יש מזהה, כך שאפשר לקשר אליה משימה בדיוק כמו לכל חלק אחר:
{{DECISIONS}}

המשימות שהדרישה כבר פורקה אליהן, לפי seq:
{{TASKS}}

החזר אובייקט JSON אחד:

{"sections": [...], "links": [...], "corrections": [...]}

sections — האפיון חתוך לחלקים הקטנים ביותר שמשימה אחת יכולה לממש, בסדר הקריאה של המסמך:
  {"anchor": "f20", "kind": "field"|"rule"|"mapping"|"heading", "parentAnchor": "h1"|null, "title": "...", "body": "..."}
  - anchor — מזהה קצר משלך, אותיות/ספרות/נקודה/מקף, ייחודי בתשובה. שיהיה בעל משמעות (f20 לשדה 20, r3a לתבליט הראשון של כלל 3), כי הקישורים למטה מצביעים עליו.
  - kind — "field" שדה שהאפיון מגדיר; "rule" התנהגות אחת עם טריגר אחד; "mapping" שורה אחת בטבלת מיפוי מקור→יעד; "heading" כותרת שמחזיקה אחרים (כותרת היא לא משהו שמממשים).
  - title — איך האפיון קורא לזה, בשפה של האפיון. body — מה שכתוב, מקוצץ, עדיין במילים של האפיון. לעולם לא בניסוח שלך.
  - כלל ממוספר עם כמה תבליטים — חתוך לחלק אחד לכל תבליט, אם משימה אחרת יכולה לממש כל אחד; השאר אותו שלם אם זו פעולה אחת.
  - דרישות שהאפיון קובע על שדה הן חלקים בפני עצמם, כשקיום כל אחת היא עבודה נפרדת: היסטוריית ביקורת דלוקה, אורך מקסימלי, הפיכה לחובה בתנאי, ברירת מחדל. שים את השדה עצמו בחלק אחד וכל דרישה כזו בחלק משלה, כדי שדרישה שאף אחד לא מימש תהיה גלויה.
  - אל תיצור חלקים עבור ההחלטות. המערכת מוסיפה אותן בעצמה.

links — איזו משימה מממשת אילו חלקים: [{"seq": 7, "anchors": ["r3a", "r3b"]}]
  - שפוט לפי מה שההוראה של המשימה אומרת שהיא עושה, מול החלק. משימה יכולה לממש כמה חלקים, וחלק יכול לדרוש כמה משימות.
  - משימה שלא מממשת שום דבר במסמך (תשתית, משימת בדיקה) פשוט לא מופיעה.
  - מזהה יכול להיות של החלטה: קשר אליה את המשימה שמבצעת את מה שההחלטה קבעה.
  - השאר חלק בלי קישור כשאף משימה לא מכסה אותו. הפער הזה הוא הדבר הכי שימושי בתשובה — לעולם אל תמציא קישור כדי שהאפיון ייראה מכוסה.

corrections — היכן שהחלטה גוברת על מה שכתוב במסמך: [{"anchor": "r3e", "decision": 2, "correction": "בקרת מנהל"}]
  - decision הוא המספר מהרשימה למעלה. correction הוא מה שתקף במקום, בכמה מילים.
  - רק היכן שההחלטה באמת סותרת את מילות המסמך. החלטה שרק מוסיפה פירוט אינה תיקון.

ענה באובייקט ה-JSON ותו לא.$p$
);
