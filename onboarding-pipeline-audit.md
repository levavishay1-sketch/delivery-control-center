# ביקורת מלאה על 16 שלבי ה-Repository AI Enablement Pipeline

_נכתב: 2026-09-18. כל שורה כאן מבוססת על קריאת קוד בפועל
(`packages/core/src/repo-onboarding/stages/*.ts`, 1160 שורות, כל ה-16 קבצים
נקראו במלואם) ו/או מקור חיצוני מאומת (נקרא מהקובץ הגולמי, לא מתקציר
חיפוש) — לא על ניחוש. איפה שמשהו לא אומת, זה מסומן במפורש._

## מטרת המסמך
המשתמש ביקש: לאמת את כל 16 השלבים מול כל הממצאים, לשאוף לצמצום שלבים
ולעליית איכות. זה לא "השלבים הכי טובים בעולם" — הביקורת הזו נועדה
לבדוק את זה ברצינות, לא להצדיק את מה שכבר קיים.

---

## טבלת כל 16 השלבים

| # | Stage | LLM call? | כותב קובץ? | ממצא |
|---|---|---|---|---|
| 01 | `workspace_setup` | לא | לא | נקי. פעולות git דטרמיניסטיות בלבד |
| 02 | `repository_scan` | לא | לא (רק DB) | נקי. סריקת filesystem דטרמיניסטית |
| 03 | `classification` | כן (זול, בלי file access) | לא | נקי |
| 04 | `security_permissions` | לא | לא (מחכה לאישור אנושי) | נקי |
| 05 | `knowledge_coverage` | כן | לא | **מועמד למיזוג** (ראה למטה) |
| 06 | `targeted_discovery` | כן | לא | **מועמד למיזוג** |
| 07 | `human_enrichment` | כן | לא | נקי — human-in-the-loop אמיתי |
| 08 | `knowledge_generation` | כן | **כן** `docs/ai/*.md` | נקי טכנית, אבל נתיב לא תואם מפרט |
| 09 | `claude_md_generation` | כן | **כן** `CLAUDE.md` | נקי — יש הגנה נגד false-Completed |
| 10 | `scoped_rules` | כן ×2 | לא (רק טיוטה) | נקי — כתיבה בפועל נדחית ל-12 בכוונה |
| 11 | `guardrails` | לא | **כן** `.claude/settings.json`+hooks | נקי |
| 12 | `ai_doctor` | כן | **כן** `.claude/rules/*.md` | **באג מאומת** (ראה למטה) |
| 13 | `user_review` | לא | לא | **פער תהליכי** (ראה למטה) |
| 14 | `github_pull_request` | לא | לא (רק tmp file חיצוני) | נקי — טיפול fallback טוב |
| 15 | `ai_ready` | לא | לא | נקי — בדיקת git מכנית טהורה |
| 16 | `skills_evaluation` | כן ×2 | **לא בכלל** | **פער תהליכי חמור** (ראה למטה) |

**רק 4 מתוך 16 כותבים קובץ לריפו בפועל**: 08, 09, 11, 12.

---

## ממצאים מאומתים — לא ניחושים

### 1. באג: `ai_doctor` מריץ `npm run build`/`test` בלי `npm install`
`grep` מלא על כל `packages/core/src/repo-onboarding/` לא מצא אף קריאה
ל-`npm install`/`npm ci` באף שלב. `ai-doctor.ts:63-75` מריץ
`execFileSync("npm", ["run","build"/"test"], {cwd: workspaceDir})` ב-worktree
שרק שוכפל מ-git. בלי `node_modules`, זה כמעט תמיד ייכשל — לא כי הריפו
לא מוכן, אלא כי אין תלויות מותקנות. הכישלון נכנס ל-`deterministicFailed`
שמפיל את כל ה-run ל-`NOT_READY`. **false negative שיטתי על רוב ריפואי
ה-npm**.
תיקון אפשרי: להוסיף install לפני, או להוציא build/test מ-`deterministicFailed`
ולהפוך אותם ל-warning בלבד.

### 2. פער חמור: `skills_evaluation` אף פעם לא כותב `SKILL.md`
מאומת מהקוד (`skills-evaluation.ts:8-18`, הערת התכנון עצמה): השלב
מנסח `draftedSkills` כ-**data בלבד**, בכוונה, כי הוא רץ **אחרי** `ai_ready`
— הענף כבר מוזג. אין שום מנגנון PR/commit נפרד שממשיך ומממש את זה.
בניגוד ל-`scoped_rules`→`ai_doctor` (שם יש מנגנון materialization מאוחר
יותר), ל-`skills_evaluation` **אין** שלב מקביל — כי הוא כבר האחרון.
בפועל: ההמלצות ל-Skills פשוט **נשארות תקועות ב-DB, לעולם לא הופכות
לקובץ אמיתי**, אלא אם מישהו בונה flow נפרד ידנית. זו לא "אופטימיזציה
נדחית" כמו `scoped_rules` — זו תכונה שמובטחת (Phase 6: "skills evaluation")
אבל בפועל **אף פעם לא מספקת את מה שהיא מתיימרת לספק**.

### 3. פער תהליכי: `user_review`'s "request_changes" לא עושה כלום
מאומת מהקוד (`user-review.ts:35-37`): כשמשתמש בוחר `request_changes`,
ההערה בקוד עצמה אומרת "**אין מנגנון חזרה אוטומטי לשלב קודם; יש לטפל
ידנית ולהריץ מחדש את התהליך במידת הצורך**". כלומר שער הביקורת האנושית
היחיד בכל הפייפליין (13/16) — אם המשתמש דוחה — לא מפעיל שום תיקון
אוטומטי, רק מסמן warning. זה הופך את "User Review" לשער חד-כיווני:
לאשר או להתחיל הכול מחדש ידנית.

### 4. מיזוג מוצדק: `knowledge_coverage` + `targeted_discovery`
מאומת מהקוד: stage 05 הוא **advisory בלבד, לא gating** (התיעוד בקוד
אומר את זה במפורש: "not gating... nothing downstream strictly requires
this to have succeeded"), בעוד ש-06 הוא "the pipeline's core deliverable".
זו הרצת Claude Code שנייה נפרדת בשביל "תבדוק תיעוד קיים" ואז שלישית
בשביל "תגלה את מה שחסר" — כש-`codebase-onboarding` (affaan-m/everything-claude-code,
נקרא מהמקור הגולמי) עושה בדיוק את שתי המשימות **בתוך stage אחד**
("Architecture Mapping"), עם כלל מובנה "trust code over config when
they conflict". אין סיבה טכנית אמיתית לשתי הרצות — רק לשלב 06 יש
תלות downstream אמיתית.

---

## מה שנבדק וכן התברר מוצדק — לא כל דבר הוא בעיה

- **`ai_doctor` מול `ai_ready`**: לא כפילות. `ai_doctor` = קריאת LLM+כתיבת
  קבצים; `ai_ready` = בדיקת git מכנית טהורה (`merge-base --is-ancestor`),
  אין בה LLM בכלל. שני דברים אמיתיים ושונים.
- **`knowledge_generation` מול `claude_md_generation`**: לא פיצול מלאכותי.
  `claude_md_generation` קורא בפועל מהדיסק את מה ש-`knowledge_generation`
  כתב (תלות write-then-read אמיתית), לא רק מקבל כמשתנה.
- **guardrails hook-detection regex ב-`ai_doctor`**: נבדק מול הפורמט
  שנכתב בפועל ב-`settings-adapter.ts:67` (`node "$CLAUDE_PROJECT_DIR/${path}"`)
  — תואם במדויק. לא באג.

---

## אימות מול מקורות חיצוניים (11 מקורות, פורט המלא בשיחה)

**מה ש-DCC עושה שאין באף מקור חיצוני שנבדק**: `human_enrichment`
(שאלות לבן-אדם), `ai_doctor` (QA pass נפרד עם קריאת LLM), `user_review`
(human gate), `github_pull_request`+`ai_ready` (מנגנון delivery מלא
עם מעקב merge). כל אלה אמיתיים ומקוריים — לא בדוי.

**מה שחסר לגמרי מול frameworks מאומתים (kodustech/agent-readiness —
7 pillars, 39 בדיקות, נקרא מהמקור הגולמי; Factory.ai — 8 pillars,
תקציר בלבד)**: DCC אין לו שום stage ל-**Testing readiness**,
**CI/CD readiness**, **Dev Environment reproducibility**, **Code Health**
(dependency freshness/dead code) — כל אלה pillars מרכזיים בשני
ה-frameworks המאומתים, ואף אחד לא מכוסה ב-16 השלבים.

---

## הצעת תהליך מצומצם: 16 → 14 stages

```
01 workspace_setup            [ללא שינוי]
02 repository_scan            [ללא שינוי]
03 classification             [ללא שינוי]
04 security_permissions       [ללא שינוי]
05 discovery                  [מיזוג: knowledge_coverage + targeted_discovery]
06 human_enrichment           [ללא שינוי]
07 knowledge_generation       [ללא שינוי]
08 claude_md_generation       [ללא שינוי]
09 scoped_rules               [ללא שינוי]
10 guardrails                 [ללא שינוי]
11 ai_doctor                  [תיקון: npm install, או להוציא build/test מה-gate]
12 user_review                [תיקון: תיעוד מפורש של המגבלה, או loop-back אמיתי]
13 github_pull_request        [ללא שינוי]
14 ai_ready                   [ללא שינוי]
```

`skills_evaluation` **מוצא מ-`STAGE_ORDER` לגמרי** — הוא לא מייצר תוצר
אמיתי כרגע (ראה ממצא #2), ולכן לא שייך לתהליך הליבה. אם רוצים לשמר
את הרעיון, זה צריך flow נפרד (post-onboarding, on-demand, עם PR משלו) —
לא stage שרץ ואף פעם לא מסתיים במשהו קונקרטי.

**זה עדיין לא סקירה סופית** — נבדקו 16/16 stages ברמת "האם יש באג/פער
אמיתי", אבל לא נבדקה כל שורת קוד בכל קובץ (למשל `scanner.ts`,
`runner.ts`, `state-machine.ts` עצמו לא נסרקו לבאגים באותה קפדנות).
