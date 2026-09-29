# שלב 4 של תשתית הפיילוט: עותק הסוכן, ה-runner וזיהוי זליגה

נוצר על ידי `npm run -w @dcc/research sim:step4` מהקוד בקומיט `c39c82f4d523fb30be9360dca434ec0deb5bf8dc`, על מאגר סינתטי ועם סוכן מדומה. אין קריאת מודל, אין רשת מחוץ ל-127.0.0.1, ואין שינוי בהגדרות המחשב.

**שלושה סוגי תוצאה שאינם מחליפים זה את זה.** בדיקת קוד אומרת שהקוד עושה מה שהוא מתאר. זיהוי אומר שמנגנון מצא ממצא בהרצה. אכיפה אומרת שהסביבה מנעה משהו. זיהוי מוצלח אינו אכיפה, ובדיקת קוד מוצלחת אינה זיהוי בהרצה אמיתית.

## א. סדר זמנים: העותק מול מצב ההתחלה S_c

בדיקת קוד של הבונה והבודק על מאגר סינתטי. כל שורה מלבד הראשונה היא הפרה מכוונת.

| מקרה | צפוי | מה נמצא | השלכה |
|---|---|---|---|
| עותק תקין, עם קבצים שנוצרו מ-F | אין הפרה | — | VALID |
| קומיט עתידי נמשך למאגר והמצביע נמחק | אובייקט זר, קומיט המשימה קיים | REFLOG_PRESENT, STATE_FILE, FOREIGN_OBJECT, TASK_COMMIT_PRESENT | INVALID |
| תג, remote, alternates, reflog ו-FETCH_HEAD | כל אחד מהם | EXTRA_REF, REMOTE_CONFIGURED, ALTERNATES, REFLOG_PRESENT, STATE_FILE, FOREIGN_OBJECT, TASK_COMMIT_PRESENT | INVALID |
| קבצים שנוצרו מקומיט המשימה | INVALID | OVERLAY_NOT_BEFORE_START | INVALID |
| קבצים מקומיט מוקדם בתאריך שאינו אב של S_c | INVALID, ואי-ההתאמה מדווחת | OVERLAY_NOT_BEFORE_START, OVERLAY_DATE_ANCESTRY_DISAGREE | INVALID |
| קבצים שנוקבים בשם שהפתרון מוסיף | FLAG | SOLUTION_TOKEN_IN_OVERLAY | FLAG |
| קובץ עתידי ושינוי בעץ העבודה | INVALID | WORKTREE_MISMATCH | INVALID |

## ב. ה-runner עם סוכן מדומה

כל שורה היא הרצה אחת על עותק טרי. "מנגנון" הוא המנגנון שמצא את הממצא, ואם אין, הממצא לא התגלה. "אכיפה" נכונה רק לתקרות ולמשתני הסביבה.

| מקרה | סוג | סטטוס ההרצה | מנגנונים שמצאו | רשומות יציאה | סטטוס הראיה |
|---|---|---|---|---|---|
| הרצה תקינה | בסיס | COMPLETED (result event and exit 0) | לא התגלה | — | VALID |
| קריאת הזיכרון הסינתטי ובדיקת הייחוס, בנתיב מוחלט | זיהוי | COMPLETED (result event and exit 0) | canary, transcript-path | — | UNDEFINED |
| קריאה בידי תוכנה שהסוכן הפעיל, בלי עקבות | מגבלת זיהוי | COMPLETED (result event and exit 0) | לא התגלה | — | VALID |
| כתיבה לחומרי הרתמה | זיהוי | COMPLETED (result event and exit 0) | transcript-path, snapshot | — | UNDEFINED |
| רשת דרך הפרוקסי, יעד שאינו ברשימה | רישום וחסימה | COMPLETED (result event and exit 0) | egress-log | GET forbidden.invalid:80 denied; CONNECT forbidden.invalid:443 denied; GET 127.0.0.1:55737 allowed | FLAGGED |
| רשת ישירה שעוקפת את הפרוקסי | לא נחסם ולא נרשם | COMPLETED (result event and exit 0) | לא התגלה | — | VALID |
| משיכת קומיט המשימה מהמאגר המקורי בנתיב מקומי | זיהוי | COMPLETED (result event and exit 0) | transcript-path, git-after-run | — | INVALID |
| חריגה מתקרת התורות | אכיפת תקרה | CAPPED (turn cap 5) | לא התגלה | — | INCOMPLETE |
| חריגה מתקרת הזמן | אכיפת תקרה | CAPPED (wall-clock cap 1500 ms) | לא התגלה | — | INCOMPLETE |
| עלות מעל התקרה, מדווחת בסוף | בדיקה לאחר ההרצה | COMPLETED (result event and exit 0) | לא התגלה | — | VALID |
| עצירה מבחוץ באמצע ההרצה | סיווג | ABORTED (stopped from outside the run) | לא התגלה | — | INVALID |
| קריסת הסוכן באמצע ההרצה | סיווג | CRASHED (exit 3 without a result event) | לא התגלה | — | UNDEFINED |

**הרשת הישירה:** המאזין המקומי של הבדיקה עצמה קיבל 1 חיבור(ים) עם המטען `leaked-payload`. הרתמה לא חסמה ולא רשמה אותם. בהרצה אמיתית אין מאזין כזה, ולכן אין שום עדות.

## ג. מה הסביבה אוכפת בפועל

| תחום | מצב |
|---|---|
| environmentVariables | ENFORCED at spawn: the child receives only the variables the harness lists |
| userSettingsLocation | REDIRECTED: home, AppData and CLAUDE_CONFIG_DIR point into a synthetic home; the real one stays readable by absolute path |
| fileSystemReads | NOT ENFORCED: same OS user; detected by canaries and by paths in the transcript only |
| fileSystemWrites | NOT ENFORCED: detected by snapshots of watched directories only |
| egressThroughProxy | BLOCKED AND RECORDED for programs that honour HTTP(S)_PROXY |
| egressDirect | NOT BLOCKED AND NOT RECORDED: a direct socket never reaches the proxy |
| operatingSystemIsolation | ABSENT: no firewall rule, network namespace, container or separate OS user is configured (that would be a system security change) |
| isolationProven | false |
