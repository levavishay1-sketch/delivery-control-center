-- 0051 — the breakdown is told the roles, not a depth.
--
-- A TFS type is the role a node plays in the tree: a leaf is a Task, what
-- holds Tasks is a User Story, what holds Stories a Feature, what holds
-- Features an Epic (task-types.ts). The prompt used to ask for a "depth" and
-- let the depth pick the type, which typed a ragged tree by which level it was
-- drawn on. It also never said the organisation's rule: more than one User
-- Story needs a Feature above it, one does not. The requirement itself is that
-- Feature, so the breakdown must not invent a Feature node just to group its
-- stories, and must not wrap a single deliverable in a lone story.
-- Changed only where no person has edited the prompt.
UPDATE "prompt_template" SET
  "body" = replace(replace("body",
    $a$Choose the depth by how much structure the work genuinely has — do not pad it:
  depth 1 — a handful of sibling tasks, no grouping needed
  depth 2 — a few deliverables, each with its own tasks
  depth 3 — several deliverables that group under themes
  depth 4 — only for very large, multi-theme work$a$,
    $b$Every node has a ROLE, and the role — not how deep it sits — is what becomes its TFS work-item type:
  a LEAF is a Task — one focused unit of work;
  a node whose children are Tasks is a User Story — a deliverable someone could accept on its own;
  a node whose children are User Stories is a Feature, and a node whose children are Features is an Epic.
The REQUIREMENT itself is a node of the same tree, and DCC gives it the rung above your top-level nodes whenever there are two or more of them: several User Stories under it make the requirement a Feature, several Features make it an Epic. That is the organisation's rule — more than one User Story needs a Feature above it; a single one does not. So:
  - Do NOT write a Feature (or Epic) node just to group the requirement's User Stories — the requirement itself is that Feature. Write Feature nodes only when the work truly has several separate Features.
  - Do NOT wrap a single deliverable in a lone User Story, Feature or Epic just to have a parent: one deliverable is its Tasks, directly at the top. A single User Story is fine when it is a real, named deliverable — but then there is no Feature above it.
  - User Stories that run in parallel are still User Stories. If one depends on another, say so with `dependsOnSeq`; ordering never turns a story into a task and never merges stories.
Choose the structure by how much the work genuinely has — do not pad it:
  a handful of related pieces of work, no separate deliverables — Tasks only
  two or more separate deliverables — one User Story for each, with its own Tasks
  deliverables that group under separate themes — Features above the stories (rare)$b$),
    $a$Max depth 4, 3-20 nodes total.$a$,
    $b$Max depth 3 when your top level has two or more nodes (the requirement takes the rung above them), depth 4 only when it has exactly one; 3-20 nodes total.$b$),
  "body_he" = replace(replace("body_he",
    $a$בחר את העומק לפי כמה מבנה באמת יש בעבודה — בלי לנפח:
  עומק 1 — כמה משימות אחיות, בלי צורך בקיבוץ
  עומק 2 — כמה תוצרים, לכל אחד משימות משלו
  עומק 3 — כמה תוצרים שמתקבצים תחת נושאים
  עומק 4 — רק לעבודה גדולה מאוד, עם כמה נושאים$a$,
    $b$לכל צומת יש תפקיד, והתפקיד — לא העומק שבו הוא יושב — הוא מה שהופך לסוג פריט העבודה שלו ב-TFS:
  עלה הוא Task — יחידת עבודה ממוקדת אחת;
  צומת שהילדים שלו הם Tasks הוא User Story — תוצר שמישהו יכול לקבל בפני עצמו;
  צומת שהילדים שלו הם User Stories הוא Feature, וצומת שהילדים שלו הם Features הוא Epic.
הדרישה עצמה היא צומת באותו עץ, ו-DCC נותן לה את המדרגה שמעל הצמתים העליונים שלך בכל פעם שיש שניים או יותר מהם: כמה User Stories תחתיה הופכים את הדרישה ל-Feature, וכמה Features הופכים אותה ל-Epic. זה כלל של הארגון — יותר מ-User Story אחד צריך Feature מעליו; אחד בודד לא. לכן:
  - אל תכתוב צומת Feature (או Epic) רק כדי לקבץ את ה-User Stories של הדרישה — הדרישה עצמה היא ה-Feature הזה. כתוב צמתי Feature רק כשיש בעבודה באמת כמה Features נפרדים.
  - אל תעטוף תוצר בודד ב-User Story, Feature או Epic בודד רק כדי שיהיה לו אב: תוצר אחד הוא המשימות שלו, ישירות בראש העץ. User Story בודד מותר כשהוא תוצר אמיתי ובעל שם — אבל אז אין Feature מעליו.
  - User Stories שרצים במקביל הם עדיין User Stories. אם אחד תלוי בשני, אמור זאת ב-dependsOnSeq; סדר אף פעם לא הופך סיפור למשימה ולא ממזג סיפורים.
בחר את המבנה לפי כמה באמת יש בעבודה — בלי לנפח:
  כמה חלקי עבודה קשורים, בלי תוצרים נפרדים — Tasks בלבד
  שני תוצרים נפרדים או יותר — User Story לכל תוצר, עם Tasks משלו
  תוצרים שמתקבצים תחת נושאים נפרדים — Features מעל הסיפורים (נדיר)$b$),
    $a$עומק מקסימלי 4, בין 3 ל-20 צמתים בסך הכול.$a$,
    $b$עומק מקסימלי 3 כשבראש העץ שלך שני צמתים או יותר (הדרישה תופסת את המדרגה שמעליהם), ו-4 רק כשיש בו צומת אחד בדיוק; בין 3 ל-20 צמתים בסך הכול.$b$)
WHERE "key" = 'breakdown.tasks' AND "updated_by" IS NULL;
