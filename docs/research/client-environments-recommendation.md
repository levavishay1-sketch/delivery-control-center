# הגדרות לקוח — סביבות, כלי בנייה ופריסה, מחברים — המלצה

**מה המסמך הזה.** תוצאת מחקר, לא החלטה. עונה על `docs/fable-brief-client-environments.md`:
מה DCC צריכה לדעת על כל לקוח כדי לנהל בסוף גם CI/CD והעלאה לסביבות; מתי זה נאסף;
מה AI יכול לגלות לבד; איך מייצגים "כלי אחר לכל סביבה"; איך שומרים על עדכניות
וסודות; ואיפה הגבול מול הטמעת ריפו בודד.

**איך נערך.** מלאי מלא של ALTSHULER_TRADE (מה יש בריפו על סביבות ופריסה — ומה אין);
קריאת מודל הנתונים של DCC (`service_connection`, `build-recipe.ts`, ההצעה
`component-deployment-management` שבבקלוג); סריקת עולם — קטלוגי IDP (Backstage,
Port, Cortex, OpsLevel), מודלי סביבה/שחרור (GitHub, Azure DevOps, Octopus, Harness,
Argo), ALM של Dynamics 365 / Power Platform בפירוט, גילוי אוטומטי של נוף לקוח,
שרתי MCP ל-CI/CD וענן (ספטמבר 2026), וסודות ב-SaaS רב-לקוחות. הממצאים המלאים
עם מקור לכל טענה: `scratchpad/research/world-client-environments.md`. דרגות: **[A]**
תיעוד רשמי / מחקר · **[B]** תצפית · **[C]** דיווח מעשי.

---

## 1. השורה התחתונה

**כל מה שקשור לפריסה אצל Trade חי מחוץ לריפו** — אין CI, אין סקריפטים, ה-solution
הראשי של Dataverse לא ב-git, רישום ה-plugin steps קיים רק בתוך Dataverse, וסביבת
הייצור מופיעה רק בקובץ בדיקה עם סיסמה בתוכו. זו לא בעיה של CLAUDE.md; זו בעיה של
**רשומת לקוח** שעדיין לא קיימת ב-DCC. שש המלצות:

1. **להגדיר במפורש שתי ישויות שאף קטלוג בעולם לא נותן כברירת מחדל: סביבה ולקוח.**
   Backstage, Port, Cortex ו-OpsLevel לא מכירים "Environment" כישות, ורק Octopus
   מכיר "Tenant" [A]. כל כלי פריסה מתכנס לאותם שישה עצמים: **מוצר-לפריסה × סביבה
   (מדורגת, עם שערים) × יעד × הפניה-לאישור × הגדרות-לפי-(מוצר,סביבה) × תהליך**
   [A]. זה מודל הנתונים (סעיף 5.1), והוא מרחיב את ההצעה שכבר בבקלוג
   (`component-deployment-management`) — לא מחליף אותה.
2. **"כלי אחר לכל סביבה" הוא מאפיין של היעד, לא של הלקוח.** ב-Harness סוג הפריסה
   שייך ל"הגדרת התשתית", ושירות נקשר רק ליעד תואם [A]. אצל Trade: יעד dev =
   `pac plugin push` + רישום steps ב-PRT; יעדי test/prod = ייבוא managed solution
   דרך Build Tools או Power Platform Pipelines. אותה ישות "תהליך", ערכים שונים.
3. **שלושה רגעי איסוף, לא אחד.** (א) ברמת הלקוח, לפני כל ריפו: זהויות והסכמה,
   רשימת סביבות וסדרן, מיקום הכספת; (ב) בהטמעת ריפו: מה שניתן לקרוא מהקוד (כלי
   build, סוג התוצר, רמזים ב-CI) — כטיוטה לאישור; (ג) ברציפות: בדיקות (probes)
   ו-drift. השאלה "לפני או אחרי ה-onboarding?" — התשובה היא **גם וגם, וזה לא
   אותו דבר**.
4. **AI מגלה חלקית, ואת החלק הנכון.** כל "גילוי אוטומטי" בקטלוגים הוא קריאת
   קבצים מוצהרים ומשיכת מלאי מ-API [A]; הסקה של סביבות מקוד היא חדשה, greenfield
   בלבד (Azure Deployment Agent) או מאושרת-אדם [A]. **לא ניתן לגלות:** סודות,
   מזהי סביבה שחיים רק ביעד (connection IDs של Dataverse), שיוך סביבה↔לקוח וסדר
   הקידום, מי מאשר, טופולוגיית on-prem. אלה נשאלים — פעם אחת, ברמת הלקוח.
5. **סודות: DCC שומרת הפניות, לעולם לא ערכים.** פדרציה (WIF/OIDC, Lighthouse,
   GitHub App) לכל מה שתומך; כספת לפי לקוח (Key Vault ללקוח או namespace ב-Vault)
   למה שלא; runner קורא בזמן ריצה בזהות מנוהלת; סשן של אדם משתמש בזהות שלו [A].
   היום ה-PAT של ADO נשמר כמו שהוא בעמודה ("pilot") — זה הדבר הראשון שמשתנה.
6. **הגבול מול הטמעת ריפו, כמשפט:** *הריפו אומר ל-DCC מה הוא בונה ואיך; רשומת
   הלקוח אומרת לאן מותר ללכת, באיזו זהות ובאישור של מי.* ההטמעה מייצרת את
   ה**קישור** ביניהם. שום דבר בריפו לא נושא credential או כתובת ייצור (Anthropic:
   כתובות סביבה וסודות לא שייכים ל-CLAUDE.md [A]).

**מה לא לעשות:** לא לשים סביבות ו-URLs ב-CLAUDE.md; לא לבנות "סוג לקוח" עם רשימת
כלים קשיחה (CRM/Azure/AWS) — אלא יעדים עם סוג פריסה; לא לתת ל-MCP להיות המקום
שבו credential נשמר; לא להתחיל מפריסה אוטומטית — קודם המודל והרישום.

---

## 2. מה נבדק בפועל — ALTSHULER_TRADE

| מה יש בריפו | מה זה אומר |
|---|---|
| ארגוני Dataverse: `altshulerdev` (Web.config, קוד מיוצר), `altshulertest` (SSIS), `altshulercrm` (רק ב-ParserTester, כנראה ייצור) | רשימת הסביבות **ניתנת לגילוי חלקית** — כרמז, לא כעובדה; הייצור לא מוצהר בשום מקום לגיטימי |
| Azure: `d365-{dev\|tst}-weu-{in\|out}-wa01`, Key Vaults `-kv01`, Service Bus `-sb01`; פרופילי publish ל-dev/tst בלבד | שני יעדים (In = CrmApi, Out = WebJobs) × שתי סביבות; **אין שום עקבה ל-prod או UAT** |
| `IsProduction=false` בכל WebJob; `DebugMode=true` ב-Web.config עם הערה "לשנות ב-test" | החלפת סביבה **ידנית**; אין transforms; ההגדרה-לפי-סביבה חיה בראש של מי שמעלה |
| אין azure-pipelines.yml, אין GitHub workflows, אין PowerShell, אין pac/spkl, אין `.crmregister` | אין "תהליך" מוצהר; **ה-plugin steps רשומים רק ב-Dataverse** — ידע שרק אדם/פרובּ יכולים לספק |
| ה-solution הראשי (ישויות, טפסים, תפקידים, flows, רישומי steps) לא ב-git; רק 3 עטיפות PCF עם `Solution.xml` (ושני publishers שונים: `alt`, `nau`) | הריפו הוא חלק מהמוצר; ה-Deployable "solution ראשי" חי בסביבה, לא בקוד |
| ILMerge + חתימה חזקה לכל plugin; WebJobs = console + MSDeploy; PCF = npm + cdsproj; SSIS = dtproj + KingswaySoft | **חמישה סוגי תוצר בריפו אחד**, כל אחד עם כלי בנייה ופריסה אחר |
| בדיקות: 6 מבחני MSTest שצריכים CRM חי ו-web app; `settings.runsettings` עם placeholders | "בדיקה" אצל Trade = פריסה ל-dev + הרצה מולו; אין בדיקה בלי סביבה |
| `.pubxml.user` עם סיסמת Web Deploy מוצפנת; ClientSecret ב-Web.config; סיסמת ייצור ב-Program.cs; 58 `.snk` | הסודות כבר בריפו — הכספת מגיעה מאוחר מדי לחלקם; סריקה + rotate לפני שסוכן נוגע |

**מה DCC כבר יודעת שרלוונטי כאן:** `build-recipe.ts` מזהה csproj SDK/legacy ו-`package.json`
ובוחר `dotnet build` / MSBuild / `npm run build` — זה **`Deployable.build_recipe` בהתהוות**;
`service_connection` (kind + config JSON, לפי לקוח) — זו **`RelatedSystem`/`CredentialRef`
בהתהוות**, כרגע רק ל-ADO ועם ה-PAT בפנים; `component-deployment-management`
(בקלוג) — כבר מבקש "רישום רכיבים לפי לקוח + רישום סביבות לפי לקוח + רכיב×סביבה
מוגדר פעם אחת" ומזהיר לא לקבע dev/test/prod. המסמך הזה נותן לו את המודל.

---

## 3. תקדימים בעולם — מה שמשנה החלטה

| ממצא | דרגה | השלכה ל-DCC |
|---|---|---|
| Backstage: אין kind "Environment"; ריפו מקושר לאשכולות דרך annotation, והפלטפורמה מחזיקה את רשימת האשכולות עם `authProvider` לכל אחד | [A] | הריפו מצהיר זהות (`.dcc.json`), DCC מחזיקה יעדים והפניות; קשר ביניהם — לא כתובות בריפו |
| Octopus: tenant אחד ללקוח, tenant חובה בכל פריסה, משתני tenant לפי סביבה, יעדים בשם `[Env]-[Tenant]-[App]-[Component]-[N]` | [A] | תבנית ישירה לבית תוכנה עם לקוחות: הלקוח = tenant, הגדרות-לפי-(לקוח,סביבה) |
| Harness: סוג הפריסה = מאפיין של הגדרת התשתית; שירות נקשר רק ליעד תואם | [A] | "כלי אחר לכל סביבה" = `Target.deployment_type`; `Process` נבחר לפי סוג היעד |
| GitHub Environments: מאשרים נדרשים, wait timer, הגבלת ענפים, מניעת אישור-עצמי; OIDC subject כולל את הסביבה (`repo:org/repo:environment:prod`) | [A] | שערים הם מאפיין של הסביבה; זהות לכל (ריפו, סביבה) בלי סוד |
| Azure DevOps: environment + checks (approvals, business hours, exclusive lock…); service connections עם WIF (issuer ישן נפרש 2027-07-01); חיבור לא בשימוש 100 יום מושבת אוטומטית | [A] | DCC מאמצת את מודל ה-checks; משביתה הפניות לא-בשימוש; מעדיפה WIF |
| Dataverse: **plugin steps לא נכנסים ל-solution עם ה-assembly** — חייבים להוסיף כל step בנפרד; `deployment-settings.json` (connection IDs) ממולא ידנית לכל סביבה; חבילות plugin ו-`pac auth` — online בלבד; on-prem = AD/IFD + runner בתוך הרשת | [A] | מלכודות שהמודל חייב לייצג כ-preconditions וכ-"ידני"; שדה `runner_location` |
| ALM Accelerator הופסק (21.4.2026); הנתיב של Microsoft: Power Platform Pipelines (SPN לכל שלב, אין cross-tenant, אותו artifact לכל השלבים) + Build Tools עם WIF | [A] | לבנות מול Pipelines/Build Tools, לא מול ה-Accelerator; spkl לא מתוחזק |
| גילוי AI: Backstage/Harness מוצאים רק `catalog-info.yaml`; Port AI מסיק ישויות ויחסים באישור; Octopus מגלה יעדים מתגיות בזמן פריסה — אבל אדם מספק חשבון; Azure Deployment Agent — greenfield בלבד | [A] | "AI חוקר וחוזר עם מסקנות" = טיוטה מקבצים מוצהרים + מלאי מ-API, מאושרת; לא מדמיין סביבות |
| MCP (9/2026): ADO remote GA (Entra; Claude Desktop/Codex לא נתמכים), AWS GA תחת IAM של הקורא, Google 50+ שרתים, GitHub remote GA; **Dataverse MCP בלי כלי ALM**; Octopus מקומי מופסק לטובת remote; ה-CLI של Power Platform בלי `mcp` | [A] | MCP לסשנים של אדם (זהות + audit של הספק); API/CLI לצעדים דטרמיניסטיים של DCC |
| Azure Architecture Center: לעולם לא לשמור credentials של לקוח; Key Vault ללקוח (במנוי שלנו או שלו); Lighthouse להאצלה עם activity log אצל הלקוח; GitHub App tokens לשעה | [A] | "הפלטפורמה לא רואה את הסוד" — סעיף 5.8 |
| HCP Terraform: drift = מוצהר מול נצפה, בדיקה מתוזמנת, שתי תרופות — לעדכן הצהרה או להחזיר תשתית; Octopus: מדיניות בריאות + מחיקה אוטומטית של יעד לא זמין | [A] | מודל drift ל-DCC (5.7) |

---

## 4. גנריות — פרק פתיחה (מסמך הגנריות, 5.3)

- **בבית תוכנה:** הסביבות של הלקוח; הזהות — של DCC דרך הסכמה/Lighthouse/App User.
- **בייעוץ:** לאותו לקוח יכולות להיות שתי התקשרויות עם סטים שונים של סביבות
  ותקציבים; לכן **הסביבות שייכות להתקשרות (או ללקוח עם סינון לפי התקשרות)**, והזהות
  היא לעיתים של הלקוח (עובדים בתוך ה-ADO שלו).
- **ב-ISV:** הסביבות הן שלנו, הלקוח הוא רשומה; המודל זהה, ה"לקוח" ריק.
- **"אנחנו הלקוח של עצמנו" (DCC):** dev = PGlite מקומי; אין test/prod עדיין; מבחן
  מציאות למודל: הוא צריך להיראות טבעי גם עם סביבה אחת.

---

## 5. תשובות לשאלות התדריך

### 5.1 מודל הנתונים (שאלה 1)

כל שורה נושאת `client_id` + RLS. סימון: **(D)** ניתן לגילוי מהריפו · **(H)** מאדם ·
**(P)** נצפה בבדיקה.

| ישות | שדות עיקריים | הערה |
|---|---|---|
| **Client** (מרחיב את `client`) | `entra_tenant_id` (H), `identity_mode` (lighthouse / multitenant-app / per-client-spn / github-app / ado-service-connection) (H), `vault_ref` (H), `approvers[]` (H), `change_windows` (H) | היום: `ado_project_ref` בלבד |
| **RelatedSystem** (מרחיב את `service_connection`) | `kind` (ado-org / github-org / ppac-tenant / octopus-space / jenkins / key-vault / lighthouse), `address`, `credential_ref`, `api_mode` (rest / cli / mcp), `mcp_endpoint?` | ה-PAT יוצא מ-`secret_ref` להפניה |
| **Environment** | `name`, `rank` (סדר קידום) (H), `kind` (dataverse-online / dataverse-onprem / azure / aws / gcp / onprem-host / kubernetes) (D/H), `type_tag` (Production / PreProduction) (H), `region` (P), `gates[]` (מאשרים, wait, ענפים, שעות, מניעת אישור-עצמי) (H), `settings_ref` (H), `managed_flag` (P) | הכמות לא קבועה — 3, 4 או 5 |
| **Target** | `environment_id`, `target_type` (dataverse-env / azure-app-service / aws-account / k8s-cluster / vm-host / octopus-project-env…) (D/H), `address` (D/H), **`deployment_type`** (solution-import / plugin-push / msbuild-publish / helm / terraform / container / pipeline-trigger) (D/H), `credential_ref` (H), **`runner_location`** (cloud / client-network) (H), `health` {status, last_checked, last_error} (P), `discovered_from` (P) | "כלי אחר לכל סביבה" חי כאן |
| **CredentialRef** | `kind` (wif / oidc / managed-identity / spn-secret / spn-cert / github-app-installation / ado-service-connection / octopus-account / ad-password / ifd / api-key), `vault_uri` (לעולם לא ערך), `principal`, `allowed_readers[]`, `scope`, `expires_at`, `last_rotated`, `last_used`, `disabled_after_days` | |
| **Deployable** (מה ריפו מייצר) | `repo_id`, `artifact_kind` (dataverse-solution / plugin-assembly / web-resources / webjob / web-api / pcf / ssis / container / android-app…) (D), `build_recipe` {tool, command, ci_file, working_dir} (D — `build-recipe.ts` היום), `solution` {unique_name, publisher_prefix, version_scheme, managed_per_stage} (D/H), `settings_template` (D) | ריפו אחד = כמה Deployables (Trade: 5 סוגים) |
| **Process** (איך Deployable מגיע לסוג יעד) | `deployable_id`, `target_type`, `tool` (pac-build-tools / pac-cli / pp-pipeline stageId / github-actions-pp / octopus / argo / jenkins / prt-manual / spkl / msdeploy), `steps[]`, `preconditions[]` (application user קיים; Managed Environment; steps בתוך ה-solution; service connection מאושר), `verify` (WhoAmI / checker / smoke), **`manual_steps[]`** (מפורש: רישום steps ב-PRT) | הטבלה "כלי לפי סביבה" של המשתמש |
| **Promotion** (לכל Deployable) | רשימה מסודרת של (Environment, Process, gate policy), `same_artifact_required` (true ל-PP Pipelines), `rollback_policy` | |
| **Binding** (התוצר של ההטמעה) | `repo_id`, `client_id`, `deployable_id`, `environments[]` שמותר להגיע אליהן, `default_dev_target` | הצומת בין ריפו ללקוח |
| **ProbeResult / DriftEvent** | append-only דרך `appendEvent`: `observed`, `declared_hash`, `drift[]`, `probe_kind`, `actor`, `ts` | "אין פעולה שקטה" חל גם על בדיקות |

### 5.2 מתי נאסף (שאלה 2)

| רגע | מה | מי |
|---|---|---|
| **פתיחת לקוח** (לפני ריפו) | זהות והסכמה, `vault_ref`, רשימת סביבות + `rank` + שערים, מערכות קשורות, מי מאשר | אדם — טופס קצר עם "i" על כל שדה; DCC בודקת מיד (probe) שהזהות עובדת |
| **הטמעת ריפו** | Deployables + build_recipe + רמזים לסביבות מקבצי CI/config → **טיוטה** לאישור; יצירת Binding | סוכן מציע, אדם מאשר (אותו כרטיס המלצה של ההטמעה) |
| **רציף** | health של יעדים, גרסת solution בכל סביבה, service connections קיימים, הפניות שפגו | DCC (probes מתוזמנים + בזמן פריסה) |

**התשובה ל"לפני/באמצע/אחרי":** רמת הלקוח לפני; רמת הריפו באמצע; ההתאמה — אחרי,
כל הזמן. ריפו שמוטמע ללקוח בלי רשומת לקוח מקבל Binding ריק ואזהרה — לא כישלון.

### 5.3 "AI יוצא לחקירה וחוזר עם מסקנות" (שאלה 3)

כן — **בגבולות שהעולם כבר סימן.** מה שסוכן מוצא בריפו (Trade): כלי build לפי
`.sln/.csproj`; סוג תוצר (`IPlugin` + CrmSdk → plugin assembly; `.cdsproj` → PCF
solution; `webjob-publish-settings.json` → WebJob; `.dtproj` → SSIS); שמות ארגוני
Dataverse ומשאבי Azure מקבצי config ופרופילי publish; **וגם מה חסר** (CI, transforms,
solution ראשי). מה שסוכן מוצא בבדיקה מול מערכות הלקוח אחרי הסכמה: רשימת הסביבות
האמיתית (`pac org`/PPAC), application users, גרסאות solution מותקנות, environments
ו-service connections ב-ADO (מטא-דאטה, לא סודות). **מה שרק אדם:** לאיזו סביבה מותר
לגשת, סדר הקידום, מי מאשר, connection IDs לכל סביבה, כספת, on-prem. הסוכן מציג
"מצאתי / לא מצאתי / צריך ממך" — לא מנחש.

### 5.4 כמה כלים לאותו לקוח (שאלה 4)

הדוגמה של טרייד היא הכלל, והמודל מייצג אותה ישירות: אותו Deployable (plugin
assembly) → Process שונה לכל `target_type`. במסך: טבלה "Deployable × סביבה", בכל תא
ה-Process (כלי, ידני/אוטומטי, בריאות, "אומת לפני N ימים"). אין "כלי של הלקוח" —
יש כלי של יעד.

### 5.5 IDE וכלי build — של הלקוח או של הריפו? (שאלה 5)

**של הריפו** (Deployable.build_recipe), לא של הלקוח: הריפו יודע שהוא MSBuild, השני
Gradle. ה-IDE לא רלוונטי ל-DCC בכלל — הוא של המפתח; מה שרלוונטי הוא "איך בונים
מהשורת פקודה" ו"על איזו מכונה" (`runner_location` — של היעד). קו הגבול: **מה
שנדרש כדי לבנות → ריפו; מה שנדרש כדי להריץ/לפרוס → לקוח/יעד.**

### 5.6 מחברים ו-MCP ברמת לקוח (שאלה 6)

- **MCP** כשאדם בלולאה ופעולה צריכה להירשם על שמו: ADO/AWS/Google/Dataverse רצים
  בזהות הקורא ורושמים ב-audit של הספק [A] — עונה בדיוק על "זהות היא תמיד אדם".
- **API/CLI** לצעדים דטרמיניסטיים של DCC (ייצוא/ייבוא solution, הפעלת שלב, קידום):
  ל-Dataverse MCP אין כלי ALM; משימות רקע צריכות זהות שירות (WIF), אידמפוטנטיות
  ושגיאות מוקלדות; Anthropic מדרגת CLI כיעיל ביותר בהקשר [A].
- **לעולם לא** שרת MCP כמקום שבו credential נשמר.
- ב-`RelatedSystem`: `api_mode` + `mcp_endpoint` אופציונלי; DCC מזריקה לסשן של אדם
  את שרתי ה-MCP של הלקוח לפי ההתקשרות.

### 5.7 עדכניות (שאלה 7)

מודל Terraform: לכל מאפיין **מוצהר** (אדם, או AI שאושר) ו**נצפה** (probe, עם
חותמת זמן). drift = הפרש. probes: `pac org who`, `GET environments` ב-ADO, health
של Octopus, reachability ל-on-prem, גרסת solution בכל סביבה. כל probe = אירוע.
במסך: "אומת לפני N ימים", "לא נגיש מאז…", "חיבור חסר", "גרסה בייצור ≠ אחרונה
שנפרסה" — כל אחד עם "i" ועם שתי תרופות: **לקבל** (לעדכן הצהרה) או **לתקן**. הפניה
שלא הייתה בשימוש N יום מושבתת (כמו ADO), לא נשארת בשקט.

### 5.8 אבטחה (שאלה 8)

1. אפליקציה אחת רב-דיירית של DCC ב-Entra + זהות מנוהלת ל-runners.
2. הלקוח נותן הסכמה / מאציל ב-Lighthouse / מוסיף application user לכל סביבת
   Dataverse / מתקין GitHub App / יוצר service connection ב-ADO שלו.
3. כל מה שיכול — מפודרר (WIF/OIDC): אין ערך לשמור.
4. מה שלא (AD/IFD on-prem, API keys) — כספת לפי לקוח; DCC שומרת URI, מי רשאי לקרוא,
   scope, תפוגה, rotate אחרון, שימוש אחרון.
5. runner קורא בזמן ריצה בזהותו; סשן של אדם — בזהותו; כל שימוש בהפניה = אירוע
   (מי, איזה יעד, איזו ריצה) — לעולם לא ערך.
6. **מיידי, לפני הכול:** ה-PAT ב-`service_connection.secret_ref` עובר להפניה; הסודות
   שנמצאו בריפו של Trade מדווחים ללקוח ומוחלפים.

---

## 6. הדוגמה המלאה — Trade

| ישות | ערכים (D = מהריפו, H = מהלקוח, P = probe) |
|---|---|
| Client | Altshuler Trade; `entra_tenant_id` (H); identity_mode = per-client-spn עם WIF (H); vault = Key Vault של DCC ללקוח או שלהם (H) |
| Environments | dev (`altshulerdev`, rank 1, PreProduction) (D→P); test (`altshulertest`, rank 2) (D→P); prod (`altshulercrm`?, rank 3, Production, שערים: מאשר + חלון) (H); Azure: dev/tst בלבד (D); Azure prod (H) |
| Targets | dataverse-env × 3 (deployment_type: dev = plugin-push; test/prod = solution-import; runner: cloud); azure-app-service In/Out × dev/tst (msbuild-publish / msdeploy); Service Bus dev (P) |
| Deployables | 40 plugin/action/CustomAPI assemblies (ILMerge, .snk); 4 WebJobs; CrmApi (Web API); 3 PCF (npm + cdsproj, publishers `alt`/`nau`); 2 SSIS packages (KingswaySoft); 58 web resources; **ה-solution הראשי — לא בריפו** |
| Processes | plugin → dev: `pac plugin push` + **ידני: רישום steps/images ב-PRT** + הוספת steps ל-solution; plugin → test/prod: managed solution import (`--settings-file`), precondition: application user + steps ב-solution; WebJob → app service: MSDeploy (`.pubxml`); PCF → cdsproj pack → solution import; SSIS → ispac deploy (ידני, SSDT); web resources → publish (ידני היום) |
| Promotion | dev → test → prod; אותו artifact managed; rollback: גרסה קודמת (Pipelines שומר גיבוי) |
| חסר ורק אדם | prod ו-UAT; מי מאשר; connection IDs לכל סביבה; האם יש PP Pipelines; runner Windows לבנייה |

---

## 7. איך זה נראה למשתמש

מסך "נוף הלקוח" (בתוך מסך הלקוח): (1) כרטיס זהות והסכמה — מה עובד, מה חסר;
(2) טבלה Deployable × סביבה, בכל תא כלי/ידני/בריאות/"אומת לפני"; (3) כרטיסי drift
עם "לקבל / לתקן"; (4) כספת: הפניות בלבד, תפוגות; (5) יומן: כל probe, כל שימוש.
בהטמעת ריפו: כרטיס "מה מצאתי על הפריסה" עם "מצאתי / לא מצאתי / צריך ממך".
**בשלב ראשון DCC רושמת ומאמתת — לא פורסת.** פריסה כפעולה מפורשת (עם "i" שאומר מה
יקרה) באה אחרי שהמודל חי חודש עם לקוח אמיתי.

---

## 8. מה משתנה לעומת הקיים, ומה נשאר

**נשאר:** `service_connection` כשלד; `build-recipe.ts`; `.dcc.json` (זהות בלבד);
העיקרון ש-DCC לא פורסת אוטומטית (`component-deployment-management`).
**משתנה:** נוספות Environment/Target/CredentialRef/Deployable/Process/Promotion/Binding;
ה-PAT הופך להפניה; probes ו-drift כאירועים; מסך נוף לקוח; ההטמעה מייצרת Binding.

**מה זה אומר עבור DCC עצמו:** DCC כלקוח של עצמו — סביבה אחת (dev, PGlite), Deployable
אחד (המונוריפו), Process = `npm run …`. אם המסך נראה טיפשי עם סביבה אחת — המודל
לא מספיק גמיש.

---

## 9. מה עוד לא ידוע

1. האם ל-Trade יש Power Platform Pipelines או שהקידום ידני לגמרי (שאלה ללקוח).
2. איפה תהיה הכספת — במנוי של DCC או של הלקוח (החלטה עסקית + חוזית).
3. האם יש UAT/סביבות נוספות שלא מופיעות בריפו.
4. עד כמה probes מול Dataverse/ADO אפשריים עם ההרשאות שהלקוח ייתן.

---

## 10. תוכנית ביצוע מוצעת (שינויי OpenSpec)

1. **`client-landscape-model`** (בינוני, מיגרציה): הישויות של 5.1; ה-PAT להפניה; RLS
   על הכול; מסך נוף לקוח לקריאה.
2. **`landscape-discovery-in-onboarding`** (קטן): הסוכן מפיק Deployables + טיוטת
   סביבות מהריפו; Binding; כרטיס "מצאתי/לא/צריך".
3. **`credential-refs-and-vault`** (בינוני, אבטחה): Key Vault ללקוח / WIF; audit של
   שימוש.
4. **`landscape-probes-and-drift`** (קטן): probes מתוזמנים, אירועים, כרטיסי drift.
5. **`deploy-actions`** (גדול, אחר כך): Process כפעולה — ייבוא solution, publish;
   מחליף/מממש את `component-deployment-management`.

סדר: 1 → 3 → 2 → 4 → 5.

---

## 11. החלטות שרק אתה יכול לקבל

1. **מודל הזהות ללקוח הראשון:** SPN של DCC אצל הלקוח (עם WIF) או Lighthouse/
   הסכמה לאפליקציה רב-דיירית. ההמלצה: SPN+WIF ל-Dataverse, GitHub App ל-git.
2. **הכספת:** Key Vault במנוי של DCC לכל לקוח (פשוט לנו) או במנוי של הלקוח (שליטה
   להם). ההמלצה: אצלנו לפיילוט, אצלם כאופציה חוזית.
3. **האם DCC פורסת בכלל בשנה הקרובה, או רק רושמת ומאמתת.** ההמלצה: רושמת ומאמתת
   קודם; פריסה כפעולה מפורשת אחרי חודש עם Trade.
4. **הסביבות שייכות ללקוח או להתקשרות** (תלוי בהחלטה במסמך הגנריות).
5. **מה אומרים ל-Trade על הסודות בריפו, ומתי.**
