-- 0044 — a node of the breakdown that has children is a group: its work is
-- exactly its children, and it is never implemented itself (task-relations.ts).
-- The breakdown prompt asked for an implementation instruction on EVERY task
-- node, so a group's own prompt read like one and invited running it — which
-- rewrote its children's work on a branch of its own. Said plainly now, in
-- both languages. Changed only where no person has edited the prompt.
UPDATE "prompt_template" SET
  "body" = replace(replace("body",
    'Leaves are the actual units of work.',
    'Leaves are the actual units of work. A node WITH children is a group: it is never implemented itself — its work is exactly its children, so leave nothing to a parent that is not in one of its children.'),
    '"task"; verify/test/document it, if "check").',
    'a leaf "task"; verify/test/document it, if "check"; for a group — a "task" with children — say what the group delivers as a whole, never an instruction to implement it directly).'),
  "body_he" = replace(replace("body_he",
    'העלים הם יחידות העבודה בפועל.',
    'העלים הם יחידות העבודה בפועל. צומת שיש לו ילדים הוא קבוצה: הוא אף פעם לא ממומש בעצמו — העבודה שלו היא בדיוק הילדים שלו, ולכן אל תשאיר לאב שום דבר שאין באחד הילדים.'),
    '(לממש אותו אם הוא "task"; לאמת/לבדוק/לתעד אותו אם הוא "check")',
    '(לממש אותו אם הוא עלה מסוג "task"; לאמת/לבדוק/לתעד אותו אם הוא "check"; בקבוצה — צומת "task" שיש לו ילדים — לתאר מה הקבוצה כולה משיגה, ולעולם לא הוראה לממש אותה ישירות)')
WHERE "key" = 'breakdown.tasks' AND "updated_by" IS NULL;
