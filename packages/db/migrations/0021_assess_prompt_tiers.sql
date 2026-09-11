-- 0021 — the "בחינת בשלות הדרישה" pre-flight choice becomes 5 real,
-- separately-authored, separately-editable prompt templates (not one
-- shared template with a substituted instruction) — quick/standard/
-- thorough/audit, each with its own suggested model, plus a custom
-- scaffold the user can add emphasis to. `body_he` is a hand-authored
-- Hebrew translation for the preview modal only — never sent to Claude.
ALTER TABLE "prompt_template" ADD COLUMN IF NOT EXISTS "body_he" text;--> statement-breakpoint
ALTER TABLE "prompt_template" ADD COLUMN IF NOT EXISTS "sort_order" integer NOT NULL DEFAULT 0;--> statement-breakpoint

UPDATE "prompt_template" SET
  "key" = 'assess.readiness.standard',
  "title" = 'בחינת בשלות — רגילה',
  "description" = 'איזון בין מהירות לעומק. ברירת המחדל.',
  "sort_order" = 2,
  "default_model" = 'sonnet',
  "body" = 'You are assessing a software requirement''s READINESS for a delivery team — this is a "Definition of Ready" check, not a code review and not an implementation. This is a STANDARD-depth pass: balance speed and depth — explain your reasoning briefly, without walking through full processes unless it genuinely matters. Judge only whether the requirement is specified clearly enough that a developer (or an AI coding agent) could start implementing it without having to guess or ask basic questions first.

Ground your judgment in these criteria (adapted from the INVEST / Definition-of-Ready framework):
- Clarity: is the intent unambiguous? Could two people read it and build different things?
- Scope: is it bounded — a specific, describable change, not an open-ended direction?
- Testability: is there an implicit or explicit way to tell the change worked?
- Dependencies: does it depend on something (a decision, another change, a piece of data) that is not resolved yet?
- Feasibility: given the actual code, does anything in the requirement conflict with how the system already works, or reference something that does not exist?

{{REPO_CONTEXT}}

REQUIREMENT:
{{REQUIREMENT}}

Do this:
1. Restate the requirement clearly — a short title plus a 2-5 sentence summary that someone with NO context on this system or requirement could read and understand what is being asked. You may name code symbols / file paths in English, but everything else must be Hebrew.
2. Decide if it is "baked" — specified well enough to start implementing — or if there are gaps: ambiguities, missing decisions, or unresolved dependencies a person must resolve first.
3. List the gaps (empty array if baked). For each: is it BLOCKING (implementation cannot meaningfully start without an answer) or not, and roughly how confident you are that it is a real gap and not just missing detail that does not matter (0-1).
4. Write a short "rationale" explaining the baked/not-baked call in plain language — this is what a person will read to decide whether to trust your judgment, so justify it concretely (reference the actual requirement text or code, not generic phrases).

IMPORTANT: write title, summary, rationale and every gap description IN HEBREW, in plain language a person unfamiliar with this specific system could follow — no internal jargon, no assuming the reader has already read the requirement. Reason in English internally if it helps, but every JSON string value must be Hebrew (code identifiers and paths may stay in English).

Respond with ONLY this JSON, no prose, no markdown fence:
{"title": string, "summary": string, "baked": boolean, "rationale": string, "gaps": [{"description": string, "blocking": boolean, "confidence": number}]}',
  "body_he" = 'אתה בוחן את הבשלות (READINESS) של דרישת תוכנה עבור צוות פיתוח — זו בדיקת "Definition of Ready", לא code review ולא מימוש. זו בדיקה בעומק רגיל: איזון בין מהירות לעומק — הסבר את הנימוקים בקצרה, בלי לפרט תהליכים שלמים אלא אם זה באמת משנה. שפוט רק האם הדרישה מוגדרת בבהירות מספקת כדי שמפתח (או סוכן AI) יוכל להתחיל לממש בלי לנחש או לשאול שאלות בסיסיות קודם.

בסס את השיפוט על הקריטריונים הבאים (מותאם ממסגרת INVEST / Definition-of-Ready):
- בהירות: האם הכוונה חד-משמעית? האם שני אנשים היו יכולים לקרוא ולבנות דברים שונים?
- היקף: האם זה תחום — שינוי ספציפי וניתן לתיאור, לא כיוון פתוח?
- ניתנת-לבדיקה: יש דרך (מפורשת או משתמעת) לדעת שהשינוי הצליח?
- תלויות: האם זה תלוי במשהו (החלטה, שינוי אחר, פיסת מידע) שעדיין לא נפתר?
- ישימות: האם משהו בדרישה סותר את האופן שבו המערכת כבר עובדת בפועל, או מתייחס למשהו שלא קיים?

{{REPO_CONTEXT}}

הדרישה:
{{REQUIREMENT}}

בצע:
1. נסח מחדש את הדרישה בבהירות — כותרת קצרה + סיכום של 2-5 משפטים שמישהו בלי שום הקשר על המערכת הזו או הדרישה הזו יוכל לקרוא ולהבין מה בעצם מבוקש.
2. קבע אם היא "אפויה" — מוגדרת מספיק טוב כדי להתחיל לממש — או שיש פערים: עמימויות, החלטות חסרות, או תלויות לא פתורות שאדם צריך לפתור קודם.
3. פרט את הפערים (מערך ריק אם אפויה). לכל אחד: האם הוא חוסם (אי אפשר להתחיל מימוש משמעותי בלי תשובה) או לא, ורמת ביטחון גסה שזה פער אמיתי ולא רק פרט חסר שלא באמת משנה (0-1).
4. כתוב "נימוק" קצר שמסביר את ההחלטה אפויה/לא-אפויה בשפה פשוטה — זה מה שאדם יקרא כדי להחליט אם לסמוך על השיפוט שלך, אז נמק בצורה קונקרטית (התייחס לטקסט הדרישה או לקוד בפועל, לא לניסוחים כלליים).

חשוב: כתוב את הכותרת, הסיכום, הנימוק וכל תיאור פער בעברית, בשפה פשוטה שמישהו שלא מכיר את המערכת הספציפית הזו יוכל לעקוב אחריה.

השב אך ורק ב-JSON הזה, בלי טקסט נוסף.'
WHERE "key" = 'assess.readiness';--> statement-breakpoint

INSERT INTO "prompt_template" ("key", "title", "description", "default_model", "sort_order", "body", "body_he") VALUES
(
  'assess.readiness.quick',
  'בחינת בשלות — מהירה',
  'טריאז'' זריז — רק לוודא שאין חוסר קריטי שחוסם התחלת עבודה.',
  'haiku',
  1,
  'You are doing a FAST triage of a software requirement''s readiness — a quick sanity check, not a full review. Spend minimal effort: catch only what obviously blocks starting work. Do not analyze deeply, do not explain process, do not speculate about edge cases.

{{REPO_CONTEXT}}

REQUIREMENT:
{{REQUIREMENT}}

Do this, briefly:
1. A one-sentence title and a 1-2 sentence summary of what is being asked.
2. Decide "baked": true only if a developer could clearly start today; false if something is missing badly enough to block starting.
3. List ONLY blocking gaps (skip minor or non-blocking ones entirely) — usually 0-2 items. One short sentence each.
4. A one-sentence rationale.

IMPORTANT: write title, summary, rationale and every gap description IN HEBREW — short and plain. Reason in English internally if it helps, but every JSON string value must be Hebrew.

Respond with ONLY this JSON, no prose, no markdown fence:
{"title": string, "summary": string, "baked": boolean, "rationale": string, "gaps": [{"description": string, "blocking": boolean, "confidence": number}]}',
  'אתה מבצע טריאז'' מהיר לבשלות של דרישת תוכנה — בדיקת שפיות זריזה, לא בדיקה מלאה. השקע מאמץ מינימלי: תפוס רק דברים שחוסמים באופן מובהק התחלת עבודה. אל תנתח לעומק, אל תסביר תהליכים, אל תשער לגבי מקרי קצה.

{{REPO_CONTEXT}}

הדרישה:
{{REQUIREMENT}}

בצע בקצרה:
1. כותרת של משפט אחד וסיכום של 1-2 משפטים על מה בעצם מבקשים.
2. קבע "אפויה": true רק אם מפתח יכול להתחיל היום בבירור; false אם חסר משהו באופן שחוסם התחלה.
3. פרט רק פערים חוסמים (דלג לגמרי על משניים/לא-חוסמים) — בדרך כלל 0-2 פריטים. משפט קצר אחד לכל אחד.
4. נימוק של משפט אחד.

חשוב: כתוב את הכותרת, הסיכום, הנימוק וכל תיאור פער בעברית — קצר ופשוט.

השב אך ורק ב-JSON הזה, בלי טקסט נוסף.'
),
(
  'assess.readiness.thorough',
  'בחינת בשלות — מעמיקה',
  'כולל הסבר תהליכים, תלויות והשלכות אפשריות. תשובה ארוכה יותר, מותר.',
  'sonnet',
  3,
  'You are assessing a software requirement''s READINESS for a delivery team — this is a "Definition of Ready" check, not a code review and not an implementation. This is a THOROUGH pass: spell out your reasoning in full, including likely effects on other processes/components, non-obvious dependencies, and edge cases you can see from the code. A longer, more detailed answer is expected and welcome here — do not compress your reasoning artificially.

Ground your judgment in these criteria (adapted from the INVEST / Definition-of-Ready framework):
- Clarity: is the intent unambiguous? Could two people read it and build different things?
- Scope: is it bounded — a specific, describable change, not an open-ended direction?
- Testability: is there an implicit or explicit way to tell the change worked?
- Dependencies: does it depend on something (a decision, another change, a piece of data) that is not resolved yet? Trace this as far as you reasonably can.
- Feasibility: given the actual code, does anything in the requirement conflict with how the system already works, or reference something that does not exist?
- Downstream impact: what else in the codebase could this change ripple into, even if the requirement does not mention it?

{{REPO_CONTEXT}}

REQUIREMENT:
{{REQUIREMENT}}

Do this:
1. Restate the requirement clearly — a title plus a full summary that someone with NO context on this system could read and understand exactly what is being asked and why it matters.
2. Decide if it is "baked" — specified well enough to start implementing — or if there are gaps.
3. List the gaps (empty array if baked). For each: BLOCKING or not, confidence (0-1), and — unlike a quick check — a sentence on WHY it matters and what resolving it would look like.
4. Write a thorough "rationale": walk through the reasoning a careful senior engineer would use, including anything you noticed in the code that the requirement text does not mention but should be aware of.

IMPORTANT: write title, summary, rationale and every gap description IN HEBREW, in plain language a person unfamiliar with this specific system could follow. Reason in English internally if it helps, but every JSON string value must be Hebrew (code identifiers and paths may stay in English).

Respond with ONLY this JSON, no prose, no markdown fence:
{"title": string, "summary": string, "baked": boolean, "rationale": string, "gaps": [{"description": string, "blocking": boolean, "confidence": number}]}',
  'אתה בוחן את הבשלות (READINESS) של דרישת תוכנה עבור צוות פיתוח — זו בדיקת "Definition of Ready", לא code review ולא מימוש. זו בדיקה מעמיקה: פרט את הנימוקים שלך במלואם, כולל השפעות סבירות על תהליכים/רכיבים אחרים, תלויות לא מובנות מאליהן, ומקרי קצה שאתה רואה מהקוד. תשובה ארוכה ומפורטת יותר צפויה ורצויה כאן — אל תכווץ את הנימוקים באופן מלאכותי.

בסס את השיפוט על הקריטריונים (INVEST / Definition-of-Ready): בהירות, היקף, ניתנת-לבדיקה, תלויות (עקוב אחריהן ככל שסביר), ישימות, והשפעה על שאר הקוד גם אם הדרישה לא מזכירה זאת.

{{REPO_CONTEXT}}

הדרישה:
{{REQUIREMENT}}

בצע:
1. נסח מחדש את הדרישה — כותרת + סיכום מלא שמישהו בלי הקשר יוכל להבין בדיוק מה מבוקש ולמה זה משנה.
2. קבע אם היא אפויה.
3. פרט את הפערים — לכל אחד: חוסם או לא, רמת ביטחון, ומשפט על למה זה משנה ואיך פתרון שלו ייראה.
4. כתוב נימוק יסודי: עבור על הנימוקים שמהנדס בכיר זהיר היה משתמש בהם, כולל כל דבר שראית בקוד שהדרישה לא מזכירה אבל כדאי להיות מודעים אליו.

חשוב: הכל בעברית, בשפה פשוטה שמישהו שלא מכיר את המערכת יוכל לעקוב אחריה.

השב אך ורק ב-JSON הזה, בלי טקסט נוסף.'
),
(
  'assess.readiness.audit',
  'בחינת בשלות — ביקורת מקיפה',
  'הבדיקה הכי יסודית, לפי תקן IEEE 830 לאיכות דרישות. מודל החזק ביותר.',
  'opus',
  4,
  'You are conducting a rigorous AUDIT of a software requirement''s readiness — the most thorough tier available, grounded in the IEEE 830 quality attributes for a good requirements specification. Treat this as a formal quality gate, not a casual read-through.

Evaluate the requirement against EACH of these IEEE 830 attributes explicitly:
- Correct: does it accurately reflect what is actually needed, as far as you can tell from context?
- Unambiguous: does every part have exactly one interpretation? Flag any term or sentence that could mean more than one thing.
- Complete: is anything essential missing — inputs, outputs, error cases, who/what triggers it?
- Consistent: does it contradict anything else you can see (other notes, other code, other stated behavior)?
- Ranked / bounded: is its scope and priority clear, or could it balloon unpredictably?
- Verifiable: is there a concrete way to prove the system satisfies it once built?
- Feasible given the codebase: does it conflict with, or depend on, code that behaves differently than assumed?
- Traceable: can you connect it to a specific place in the code or a specific existing behavior it changes?

{{REPO_CONTEXT}}

REQUIREMENT:
{{REQUIREMENT}}

Do this:
1. Restate the requirement precisely — title + summary, written so someone with zero context on this system understands exactly what is being asked.
2. Go through the 8 attributes above; for any that are NOT satisfied, that is a gap.
3. Decide "baked" only if there are no BLOCKING gaps among them.
4. List every gap found this way, each tagged with which attribute it violates, whether it is blocking, and a confidence score.
5. Write a rationale that a careful reviewer signing off on this could stand behind — reference the specific attribute and the specific text/code that triggered each concern.

IMPORTANT: write title, summary, rationale and every gap description IN HEBREW, in plain language a person unfamiliar with this specific system could follow. You may name the IEEE attribute in English inside a Hebrew sentence if there is no natural Hebrew term. Reason in English internally if it helps, but every JSON string value must be Hebrew (code identifiers and paths may stay in English).

Respond with ONLY this JSON, no prose, no markdown fence:
{"title": string, "summary": string, "baked": boolean, "rationale": string, "gaps": [{"description": string, "blocking": boolean, "confidence": number}]}',
  'אתה מבצע ביקורת (AUDIT) קפדנית לבשלות של דרישת תוכנה — הרמה היסודית ביותר הקיימת, מבוססת על מאפייני האיכות של תקן IEEE 830 למפרט דרישות טוב. התייחס לזה כאל שער איכות פורמלי, לא קריאה חטופה.

הערך את הדרישה מול כל אחד ממאפייני IEEE 830 הבאים, במפורש:
- נכונה (Correct): האם היא משקפת נכון את מה שבאמת נדרש, ככל שניתן להבין מההקשר?
- חד-משמעית (Unambiguous): לכל חלק יש פירוש אחד בלבד? סמן כל מונח או משפט שיכול להתפרש ביותר מדרך אחת.
- שלמה (Complete): חסר משהו חיוני — קלט, פלט, מקרי שגיאה, מי/מה מפעיל את זה?
- עקבית (Consistent): האם היא סותרת משהו אחר שאתה רואה (הערות אחרות, קוד אחר, התנהגות מוצהרת אחרת)?
- מדורגת/תחומה: ההיקף והעדיפות ברורים, או שזה עלול לתפוח בלתי צפוי?
- ניתנת-לאימות (Verifiable): יש דרך קונקרטית להוכיח שהמערכת עומדת בה לאחר המימוש?
- ישימה ביחס לקוד: היא סותרת, או תלויה בקוד שמתנהג אחרת ממה שהונח?
- ניתנת-למעקב (Traceable): אפשר לקשר אותה למקום ספציפי בקוד או להתנהגות קיימת ספציפית שהיא משנה?

{{REPO_CONTEXT}}

הדרישה:
{{REQUIREMENT}}

בצע:
1. נסח מחדש את הדרישה במדויק — כותרת + סיכום, כתוב כך שמישהו בלי שום הקשר על המערכת יבין בדיוק מה מבוקש.
2. עבור על 8 המאפיינים למעלה; כל מאפיין שלא מתקיים הוא פער.
3. קבע "אפויה" רק אם אין פערים חוסמים ביניהם.
4. פרט כל פער שנמצא כך, מתויג באיזה מאפיין הוא מפר, האם הוא חוסם, ורמת ביטחון.
5. כתוב נימוק שסוקר זהיר שחותם על הבדיקה הזו יוכל לעמוד מאחוריו — התייחס למאפיין הספציפי ולטקסט/קוד הספציפי שעורר כל חשש.

חשוב: הכל בעברית, בשפה פשוטה שמישהו שלא מכיר את המערכת יוכל לעקוב אחריה.

השב אך ורק ב-JSON הזה, בלי טקסט נוסף.'
),
(
  'assess.readiness.custom',
  'בחינת בשלות — מותאם אישית',
  'בסיס הבדיקה הרגילה, עם דגש נוסף שתכתוב בעצמך. חייב לבחור מודל.',
  NULL,
  5,
  'You are assessing a software requirement''s READINESS for a delivery team — this is a "Definition of Ready" check, not a code review and not an implementation. Judge only whether the requirement is specified clearly enough that a developer (or an AI coding agent) could start implementing it without having to guess or ask basic questions first.

Ground your judgment in these criteria (adapted from the INVEST / Definition-of-Ready framework):
- Clarity: is the intent unambiguous? Could two people read it and build different things?
- Scope: is it bounded — a specific, describable change, not an open-ended direction?
- Testability: is there an implicit or explicit way to tell the change worked?
- Dependencies: does it depend on something (a decision, another change, a piece of data) that is not resolved yet?
- Feasibility: given the actual code, does anything in the requirement conflict with how the system already works, or reference something that does not exist?

ADDITIONAL FOCUS REQUESTED BY THE USER FOR THIS RUN — pay special attention to this, beyond the standard criteria above:
{{CUSTOM_EMPHASIS}}

{{REPO_CONTEXT}}

REQUIREMENT:
{{REQUIREMENT}}

Do this:
1. Restate the requirement clearly — a short title plus a 2-5 sentence summary that someone with NO context on this system or requirement could read and understand what is being asked.
2. Decide if it is "baked" — specified well enough to start implementing — or if there are gaps, including anything related to the user''s additional focus above.
3. List the gaps (empty array if baked). For each: BLOCKING or not, and a confidence score (0-1).
4. Write a short "rationale" explaining the baked/not-baked call in plain language, concretely.

IMPORTANT: write title, summary, rationale and every gap description IN HEBREW, in plain language a person unfamiliar with this specific system could follow. Reason in English internally if it helps, but every JSON string value must be Hebrew (code identifiers and paths may stay in English).

Respond with ONLY this JSON, no prose, no markdown fence:
{"title": string, "summary": string, "baked": boolean, "rationale": string, "gaps": [{"description": string, "blocking": boolean, "confidence": number}]}',
  'אתה בוחן את הבשלות (READINESS) של דרישת תוכנה עבור צוות פיתוח — זו בדיקת "Definition of Ready", לא code review ולא מימוש. שפוט רק האם הדרישה מוגדרת בבהירות מספקת כדי שמפתח (או סוכן AI) יוכל להתחיל לממש בלי לנחש קודם.

בסס את השיפוט על הקריטריונים (INVEST / Definition-of-Ready): בהירות, היקף, ניתנת-לבדיקה, תלויות, ישימות.

דגש נוסף שהמשתמש ביקש עבור ההרצה הזו — שים לב לזה במיוחד, מעבר לקריטריונים הרגילים למעלה:
{{CUSTOM_EMPHASIS}}

{{REPO_CONTEXT}}

הדרישה:
{{REQUIREMENT}}

בצע:
1. נסח מחדש את הדרישה בבהירות — כותרת קצרה + סיכום.
2. קבע אם היא אפויה — כולל כל מה שקשור לדגש הנוסף של המשתמש למעלה.
3. פרט את הפערים — חוסם או לא, ורמת ביטחון.
4. כתוב נימוק קצר וקונקרטי.

חשוב: הכל בעברית, בשפה פשוטה.

השב אך ורק ב-JSON הזה, בלי טקסט נוסף.'
)
ON CONFLICT ("key") DO NOTHING;
