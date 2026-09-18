# DCC Onboarding — מפרט סופי להמשך יישום (session מקומי)

_עודכן: 2026-09-18, המשך ישיר לסשן הקודם._

## הארכיטקטורה שהוחלטה

```
<repo-root>/
├── CLAUDE.md              ← שלד: Commands, Structure, Rules, Done means + pointers ל-docs/
├── docs/
│   ├── architecture.md    ← תמיד נוצר (עודכן: לא מותנה יותר בסף 150 שורות — עקביות > יעילות)
│   ├── critical-context.md← תמיד נוצר (עודכן: לא מותנה יותר ב-domain risk)
│   ├── repository-map.md  ← תמיד, task-oriented ("Where to look for X")
│   └── integrations.md    ← תמיד נוצר (עודכן: לא מותנה יותר באינטגרציות אמיתיות)
├── .claude/
│   ├── rules/<subsystem>.md   ← עם globs, לתת-מערכות עם כללים שונים
│   ├── skills/<name>/SKILL.md ← רק אם יש עדות ל-workflow חוזר (git history)
│   ├── agents/<name>.md       ← תפקיד ביקורת חוזר
│   ├── hooks/*.mjs + settings.json ← templates סטטיים, לא LLM-generated
│   └── (DESIGN.md-style תוכן: רק pointer אם קיים כבר, אף פעם לא נוצר ע"י AI)
└── .mcp.json               ← לפי סיגנל אינטגרציה אמיתי
```

**⚠️ שינוי מהותי מהסשן הקודם**: כל 4 קבצי `docs/*.md` **תמיד** נוצרים — הוסר תנאי ה-"רק אם מוצדק". החלטה מפורשת של המשתמש: "תמיד נבנה docs בשביל הסדר גם אם פחות יעיל, גם אם פחות מ-150 [שורות]". זה לא השפיע (עדיין) על `.claude/rules|skills|agents` ו-`.mcp.json` — אלה עדיין מותנים בעדות/סיגנל אמיתי.

## כלל הליבה: reference general purpose vs. AI-only

- שימושי גם לבן אדם → תיעוד רגיל (`docs/`, לא `.claude/`)
- הנחיה ל-Claude בלבד → `.claude/rules/`
- קריטי בכל session → `@import` מ-CLAUDE.md
- reference בלבד → pointer רגיל (בלי `@`)

## תוכן CLAUDE.md — 4 סעיפים חובה

```markdown
## Commands          ← רשימה שטוחה, פקודה-שורה-לכל-דבר
## Structure          ← מפה שטוחה dir→purpose
## Rules              ← הוראות אימפרטיביות בדוקות ("X, not Y") — לא עובדות
## Done means          ← פקודת אימות קונקרטית לפני "סיימתי" (npm test && lint)
```

**best-practice מאומת חיצונית (code.claude.com/docs/memory) שתומך בכיוון הזה**:
- יעד <200 שורות, hard max במפרט שלנו 150.
- כל איסור חייב לנקוב מה נשבר ("X breaks Y") — לא רק "don't do X". הנחיות בסגנון "always double-check your work" גורמות היום ל-over-verification על Claude 5/Fable 5 — להימנע.
- `docs/*.md` צריכים להיות pointer רגיל בלי `@` — imports עדיין נטענים ב-launch, לא חוסכים קונטקסט, רק מארגנים.
- דוגמה חיה טובה לכל זה: ה-`CLAUDE.md` בפועל של הריפו הזה (68 שורות, `@openspec/project.md` import + pointer רגיל ל-`hooks/README.md`, כללים עם תוצאה מפורשת כמו סעיף PGlite).

## מנגנון יצירה לכל קובץ

| קובץ | מקור |
|---|---|
| `CLAUDE.md` (שלד) | קוד דטרמיניסטי — לא LLM |
| `docs/*.md` | DCC prompt ייעודי לכל קובץ (לא `/init`, לא copy-paste) — **תמיד רץ על כל 4, ראה שינוי למעלה** |
| `.claude/rules/*` , `skills/*`, `agents/*` | DCC prompt ייעודי |
| `.claude/hooks/*.mjs` | template סטטי, נבחר לא נוצר |
| `.mcp.json` | prompt מבוסס טבלת סיגנלים (בהשראת claude-code-setup הרשמי) |

## `/init` כשלב 0 (bootstrap) — הוחלט: כן, מריצים ראשון

נבדק בפועל מול docs.claude.com/en/memory: `/init` (עם `CLAUDE_CODE_NEW_INIT=1`) קורא `AGENTS.md`/Cursor/Copilot rules קיימים, סורק פקודות build/test, ושואל אילו artifacts להקים. אבל **אינו** מכיר את מודל התיקיות הספציפי (`docs/*.md`, `.claude/agents/`, `.mcp.json`).

כיסוי בפועל (מתוך 11 הפריטים בעץ):
- ✓/◐ 1: `CLAUDE.md` — טיוטה ראשונית בלבד, DCC מעצב מחדש ל-4 סעיפים
- ◐ 2: `.claude/skills/*`, `.claude/hooks/*` — /init שואל אם להקים, לא מייצר תוכן ספציפי-ריפו
- ✕ 8: כל `docs/*.md` (×4), `.claude/rules/*`, `.claude/agents/*`, `.mcp.json`, DESIGN.md-pointer — לא קיימים ב-/init בכלל

דיאגרמה חזותית (עם כל הפרטים, כולל skills קהילתיים שנמצאו — ראה למטה): **https://claude.ai/artifact/ABn6HGha4FAgjzuCQsXfvt**

## Skills קהילתיים קיימים שנמצאו — לא להמציא מחדש

### `repository-map.md`
**`codebase-map`** (josh-gree/my-claude-skills, אומת מהקובץ הגולמי): 7 שלבים — וידוא git remote → Task tool עם subagent **Explore** לסריקה → overview היררכי → טבלת קבצי-מפתח → mermaid dependency diagram → context ספציפי לשפה/פריימוורק → קימפול. כללי איכות קונקרטיים לאימוץ: annotations **3-8 מילים** לכל תיקייה, mermaid **10-20 nodes מקסימום**, להתמקד במבנה/יחסים לא implementation, להחריג generated/build.

**אזהרה רלוונטית**: skill מקביל, `mapping-codebases` (oaustegard/claude-skills), שיצר `_MAP.md` מבוסס-AST לכל תיקייה — **deprecated**. הכותב הפנה ל-tree-sitter ישיר במקום. מחזק את ההחלטה של `repository-map.md` task-oriented ולא ממצה.

### `architecture.md`
- **`architecture-md-generator`** (skills.rest, לא אומת מהקובץ הגולמי — דומיין חסום ל-fetch): evidence-first, בונה `ARCHITECTURE.md` + mermaid ישירות ממבנה פרויקט ותלויות. הכי קרוב ברוח ל"every fact must come from repository evidence" מהמפרט שלנו.
- **`architecture-design`** (vukhanhtruong/claude-skill-architecture-design, **לא אומת מהקובץ הגולמי** — ה-fetch משך בטעות ריפו אחר): לפי סיכום חיפוש בלבד — ראיון אינטראקטיבי 5-7 שאלות, מפיק 11 סעיפים (Project Structure, High-Level System Diagram, Core Components, Data Stores, External Integrations/APIs, Deployment & Infrastructure, Security Considerations, Dev/Testing Environment, Future Considerations, Project Identification, Glossary). לשימוש כ-checklist בלבד, לא כמקור מאומת.
- לא רלוונטי לשימוש ישיר: `software-architecture` (keez97/claude-architecture-skills) — זה reviewer/consultant אקטיבי (SOLID, ADRs, anti-patterns), לא מחולל תיעוד פסיבי.

### `.mcp.json`, `.claude/agents/`
עדיין לא נבדק אם יש skills קהילתיים מתאימים — פתוח לסשן הבא.

### `integrations.md`
- **`architecture-scan`** (toantran292/claude-skills, אומת מהקובץ הגולמי): מייצר architecture summary שכולל "external dependencies (APIs/DB/queues)" + integration points + **cross-repository dependency mapping** (רלוונטי ל-N×X model של DCC). חלקית בלבד — שטחי יותר מהדרישה המקורית (communication direction / implementation location / compatibility constraints).
- **`repo-scan`** (affaan-m/everything-claude-code) — נבדק, **לא רלוונטי**: dependency/license auditing בלבד, לא נוגע באינטגרציות חיצוניות.

### `critical-context.md` — אין skill מכני, וזה תקין
לא נמצא (ולא אמור להימצא) skill מכני — הקובץ מטבעו לא נגזר מקוד, רק מבן-אדם. המנגנון הקיים (`human_enrichment` → `knowledge_generation` עם `{{HUMAN_KNOWLEDGE}}`) כבר נכון. תבנית מקבילה שנמצאה: `known-gotchas.md` (בלוג Nick Porter) — קובץ שגדל אורגנית מתקלות, לא נוצר חד-פעמית. **הוצע לשלב עדכון מתמשך ב-refresh stage — המשתמש דחה את זה במפורש ("אולי אפשר לוותר על זה?"). לא נכנס להחלטה.**

## הצעה פתוחה — טרם הוחלטה (לא בעץ המקורי)

### `docs/adr/` (Architecture Decision Records)
נמצא skill מאומת (affaan-m/everything-claude-code, `architecture-decision-records`):
- טריגר מפורש/משתמע (בחירת framework/DB/pattern עם נימוק)
- פורמט Michael Nygard: Title/Date/Status/Deciders → Context → Decision → Alternatives Considered → Consequences
- `docs/adr/NNNN-decision-title.md` + `docs/adr/README.md` אינדקס
- טיוטה מוצגת לאישור לפני כתיבה — לא אוטומטי

**למה זה רלוונטי ספציפית ל-DCC**: מתיישר ישירות עם Non-negotiable #3 ("No silent actions... every commit, approval, dependency and why... is recorded") ו-#1 (event log — ADR הוא בעצם append-only log כרונולוגי). בניגוד ל-`critical-context.md` (מצב נוכחי, onboarding חד-פעמי), ADR נכתב **תוך כדי עבודה עתידית** — זה בדיוק מה שהמשתמש ביקש לבדוק ("קבצים... שיעזרו בפיתוח העתידי במשימות").

גרסה חלופית: **AgDR** (me2resh/agent-decision-record) — כמו ADR אבל עם frontmatter חובה `agent`/`model`/`session`/`timestamp`, תואם ל-Non-negotiable #2 ("Identity is always a real person"). ייתכן שמתאים יותר ל-DCC מ-ADR הרגיל.

**מועמדים נוספים שנבדקו ונדחו/לא הוכרעו** (מתוך אותו חיפוש): `decision-log.md` (חופף אולי ל-event_log — לא נבדק לעומק), `agents/` conventions file (חופף ל-CLAUDE.md עצמו), `CONTEXT.md` glossary (חופף ל-repository-map/architecture, לא ברור שצריך קובץ נפרד).

**סטטוס: לא הוכרע. המשתמש ביקש "נבדוק אחר כך" — לחזור לזה.**

## ולידציה

`claude plugin validate --strict` + `claude plugin eval` + build/test אמיתי + (ניסוי: `protect-mcp` ל-Cedar policy/signed receipts).

## פער מול הקוד הקיים בריפו (packages/core/src/repo-onboarding/) — עדיין לא נוגע

- `seed-prompts.ts` / `knowledge-generation.ts` / `claude-md-generation.ts` כותבים היום ל-**`docs/ai/*.md`** (תיקיית משנה), לא ל-`docs/*.md` השטוח מהמפרט.
- `onboarding.knowledge_generation` הוא **prompt אחד גדול** שמייצר את כל 4 הקבצים בתנאי "צור רק את המוצדק" — מנוגד להחלטה החדשה (תמיד כל 4) וגם למפרט המקורי ("DCC prompt ייעודי **לכל קובץ**").
- `.mcp.json` prompt — עדיין לא נכתב בפועל.
- אין עדיין stage/prompt ל-`.claude/agents/<name>.md`.
- `protect-mcp` כתחליף ל-guardrails — נבדק (12/12 טסטים), לא משולב עדיין.

## מה עוד פתוח לבדיקה

- לפצל את `onboarding.knowledge_generation` ל-4 prompts נפרדים (אחד לכל קובץ) ולתקן את הנתיב מ-`docs/ai/` ל-`docs/`, תוך שילוב מבני ה-skills הקהילתיים שנמצאו (subagent Explore, מגבלות כמותיות, mermaid).
- `.mcp.json` prompt — טרם נכתב.
- skills קהילתיים ל-`.mcp.json` ו-`.claude/agents/` — טרם נבדק.
- `protect-mcp` — נבדק, לא משולב.
- שום דבר מהאמור למעלה עדיין לא מומש בקוד — זה עדיין שלב תכנון/החלטות בלבד, לפי בקשת המשתמש המפורשת ("אני לא רוצה לתקן כלום").
