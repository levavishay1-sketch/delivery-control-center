# הטמעה על trade repository — הרצה 7d20cb73

מצב: **WaitingForUser** · צעד: deliver · מדרגה: all_approval · עלות כוללת: **$12.41** (70 קריאות)

## הצעדים

| צעד | מצב | עלות | קריאות |
| --- | --- | --- | --- |
| connect | Completed | $0.00 | 0 |
| diagnose | Completed | $0.00 | 0 |
| processes | Completed | $0.10 | 1 |
| trial | Completed | $4.89 | 23 |
| plan | Completed | $0.48 | 2 |
| build | Completed | $6.94 | 44 |
| deliver | WaitingForUser | $0.00 | 0 |

## מה האבחון ראה

- סטאק: azure-sdk, azure-service-bus, soap-wcf-web-services, dataverse-dynamics-365, .net, .net-framework, mstest, microsoft.crmsdk, microsoft.powerplatform.dataverse.client, powerapps-pcf-control, react, nuget, c#, javascript
- קבצים: 1334 · חבילות: 67
- כלים על המכונה: npm, node, dotnet, msbuild, dotnet_msbuild, vstest.console
- בדיקות: MSTest · פרויקטי בדיקה ב-git: 1 · פקודות: vstest.console Test/Alt.Test.CrmApi/bin/Debug/Alt.Test.CrmApi.dll
- build: msbuild Altshuler.sln /t:Build   # requires Windows / Visual Studio build tools · CI: אין
- מג'ונרט: 1 נתיבים + 2 קבצים לפי כותרת · קבצים רגישים: 137 · סודות: 2
- תיעוד קיים: —

## הראיון

- tools: claude (ברירת מחדל)
- forbidden_areas: as_found (ברירת מחדל)
- runner: no (ברירת מחדל)
- done_means: build (ברירת מחדל)

## הכרטיסים

48 כרטיסים: verified 25 · reported 3 · failed 5 · configured 6 · declined 8 · deferred 1

| מפתח | סוג | מקור | קבוצה | מצב | אימות | מדידה | קבצים |
| --- | --- | --- | --- | --- | --- | --- | --- |
| onboarding_docs | doc | rule | approval | verified | ✓ 102 נתיבים ופקודות נבדקו, כולם קיימים | same 3/5 עם, 3/5 בלי | docs/architecture.md, docs/integrations.md, docs/build-and-run.md |
| deny_binary_dirs | permission | rule | approval | verified | ✓ 27 כללי deny, כולם בתחביר של Claude Code | improved 1/2 עם, 1/2 בלי | .claude/settings.json |
| gitignore_hygiene | gitignore | rule | approval | verified | ✓ 5 השורות נמצאות | same 1/1 עם, 1/1 בלי | .gitignore |
| hygiene_report | report | rule | auto | reported |  |  |  |
| per_area_instructions | scaffold | rule | approval | failed | ✗ 5 טענות נבדקו; לא קיים כאן: npm run build |  |  |
| generated_gitattributes | gitattributes | rule | approval | verified | ✓ git מסמן 2 קבצים לדוגמה כמג'ונרטים | same 1/2 עם, 1/2 בלי | .gitattributes |
| no_ci_report | report | rule | auto | reported |  |  |  |
| reviewer_skill-verify-test-execution-hone_skill | skill | reviewer | approval | failed | ✗ לא קיים כאן: Test/Alt.Test.CrmApi/bin/Debug/Alt.Test.CrmApi.dll |  |  |
| deny_plugin_registration | permission | rule | approval | verified | ✓ 27 כללי deny, כולם בתחביר של Claude Code | improved 1/2 עם, 1/2 בלי | .claude/settings.json |
| deny_cloud_mutations | permission | rule | approval | verified | ✓ 27 כללי deny, כולם בתחביר של Claude Code | improved 1/2 עם, 1/2 בלי | .claude/settings.json |
| which_package_skill | skill | rule | approval | verified | ✓ name, description ו-4437 תווים; 75 נתיבים ופקודות נבדקו | same 2/5 עם, 2/5 בלי | .claude/skills/which-package/SKILL.md |
| deny_read_secret_files | permission | rule | approval | verified | ✓ 27 כללי deny, כולם בתחביר של Claude Code | improved 1/2 עם, 1/2 בלי | .claude/settings.json |
| secret_scan_hook | hook | rule | approval | verified | ✓ נחסמה בלי להדפיס את הערך; תוכן נקי עבר; .claude/settings.json מפנה אליו | improved 1/3 עם, 1/3 בלי | .claude/hooks/secret-scan.mjs, .claude/settings.json |
| secrets_report | report | rule | auto | reported |  |  |  |
| plugin_dotnet_msbuild | plugin | marketplace | approval | configured | ✓ dotnet-msbuild@claude-plugins-official רשום ב-enabledPlugins; Claude Code מתקין  | same 0/1 עם, 0/1 בלי | .claude/settings.json |
| reviewer_hook-verify-exit-code-before-suc_hook | hook | reviewer | approval | failed | ✗ unknown catalog template "" (known: block-paths, block-commands, secret-scan, bu |  |  |
| agents_md_from_profile | scaffold | rule | approval | verified | ✓ 42 נתיבים ופקודות נבדקו, כולם קיימים | same 6/9 עם, 6/9 בלי | AGENTS.md, CLAUDE.md |
| lsp_csharp_lsp | lsp | marketplace | approval | configured | ✓ csharp-lsp@claude-plugins-official רשום ב-enabledPlugins; Claude Code מתקין אותו | same 0/1 עם, 0/1 בלי | .claude/settings.json |
| mcp_cli_for_microsoft_365_mcp_server | mcp | marketplace | approval | declined (מקור לא מאומת) |  |  |  |
| mcp_azure_mcp_server | mcp | marketplace | approval | deferred |  |  |  |
| plugin_microsoft_dataverse_plugin | plugin | marketplace | approval | declined (מקור לא מאומת) |  |  |  |
| plugin_power_platform_skills | plugin | marketplace | approval | configured | ✓ power-platform-skills@microsoft-power-platform-skills רשום ב-enabledPlugins; Cla | same 0/1 עם, 0/1 בלי | .claude/settings.json |
| skill_pp_code_component_skills | skill | marketplace | approval | declined (מקור לא מאומת) |  |  |  |
| mcp_bussin_mcp_server | mcp | marketplace | approval | declined (מקור לא מאומת) |  |  |  |
| mcp_azure_utils_mcp | mcp | marketplace | approval | declined (מקור לא מאומת) |  |  |  |
| mcp_power_platform_mcp | mcp | marketplace | approval | declined (מקור לא מאומת) |  |  |  |
| mcp_microsoft_learn_mcp_server | mcp | marketplace | approval | declined (מקור לא מאומת) |  |  |  |
| skill_pcf_controls_claude_code_power_platform_skills | skill | marketplace | approval | declined (מקור לא מאומת) |  |  |  |
| agent_run_tests_build_test_project | agent | process | approval | failed | ✗ לא קיים כאן: Test/Alt.Test.CrmApi/bin/Debug/Alt.Test.CrmApi.dll |  |  |
| monorepo_rule | rule | rule | approval | verified | ✓ 4 נתיבים ופקודות בשורה נבדקו, כולם קיימים | same 6/10 עם, 6/10 בלי | AGENTS.md |
| generated_paths_guard | hook | rule | approval | verified | ✓ נחסם; קובץ מותר עבר; .claude/settings.json מפנה אליו | improved 2/4 עם, 2/4 בלי | .claude/hooks/block-paths.mjs, .claude/settings.json |
| local_gate_script | script | rule | approval | failed | ✗ קוד null:   Copying file from "C:\Users\AvishayLev\.dcc-repos-onboarding\7d20cb7 |  |  |
| dataverse_names_rule | rule | rule | approval | verified | ✓ אין בשורה נתיב או פקודה שיכולים לסתור את הקוד | same 7/11 עם, 7/11 בלי | AGENTS.md |
| pcf_toolchain_rule | rule | rule | approval | verified | ✓ 6 נתיבים ופקודות בשורה נבדקו, כולם קיימים | same 6/10 עם, 6/10 בלי | AGENTS.md |
| dataverse_mcp | mcp | rule | approval | configured | ✓ דורש את הסביבה של הלקוח: https://{org}.{region}.dynamics.com/api/mcp — לא נכתב ל | same 1/1 עם, 1/1 בלי |  |
| plugin_dotnet_skills_dotnet_test | plugin | marketplace | approval | configured | ✓ dotnet/skills — dotnet-test@dotnet-skills רשום ב-enabledPlugins; Claude Code מתק | same 0/1 עם, 0/1 בלי | .claude/settings.json |
| agent_modify_crm_entity_model_update_dataverse_schema | agent | process | approval | verified | ✓ קריאה בלבד (Glob, Grep, Read, Bash), 12 פריטי בדיקה; 10 נתיבים ופקודות נבדקו | same 0/1 עם, 0/1 בלי | .claude/agents/modify-crm-entity-model-update-dataverse.md |
| reviewer_agent-update-field-consumers_agent | agent | reviewer | approval | verified | ✓ קריאה בלבד (Glob, Grep, Read, Bash), 17 פריטי בדיקה; 14 נתיבים ופקודות נבדקו | same 0/1 עם, 0/1 בלי | .claude/agents/reviewer-agent-update-field-consumers.md |
| deny_binary_dirs_rule | rule | rule | approval | verified | ✓ 3 נתיבים ופקודות בשורה נבדקו, כולם קיימים | same 6/10 עם, 6/10 בלי | AGENTS.md |
| generated_paths_rule | rule | rule | approval | verified | ✓ אין בשורה נתיב או פקודה שיכולים לסתור את הקוד | same 7/12 עם, 7/12 בלי | AGENTS.md |
| windows_build_rule | rule | rule | approval | verified | ✓ 1 נתיבים ופקודות בשורה נבדקו, כולם קיימים | same 6/10 עם, 6/10 בלי | AGENTS.md |
| agent_pcf_control_lint_run_eslint | agent | process | approval | verified | ✓ קריאה בלבד (Glob, Grep, Read, Bash), 8 פריטי בדיקה; 7 נתיבים ופקודות נבדקו | same 0/1 עם, 0/1 בלי | .claude/agents/pcf-control-lint-run-eslint.md |
| deny_sensitive_files_rule | rule | rule | approval | verified | ✓ אין בשורה נתיב או פקודה שיכולים לסתור את הקוד | same 6/10 עם, 6/10 בלי | AGENTS.md |
| deny_sensitive_files | permission | rule | approval | verified | ✓ 27 כללי deny, כולם בתחביר של Claude Code | improved 1/2 עם, 1/2 בלי | .claude/settings.json |
| cloud_credentials_rule | rule | rule | approval | verified | ✓ אין בשורה נתיב או פקודה שיכולים לסתור את הקוד | same 7/11 עם, 7/11 בלי | AGENTS.md |
| per_package_instructions | scaffold | rule | approval | verified | ✓ 3 נתיבים ופקודות נבדקו, כולם קיימים | same 2/3 עם, 2/3 בלי | Pcf/DuplicateDetection/CLAUDE.md, Pcf/JsonParser/CLAUDE.md, Pcf/PopulationRegisterVerificationGrid/CLAUDE.md |
| lsp_typescript_lsp | lsp | marketplace | approval | configured | ✓ typescript-lsp@claude-plugins-official רשום ב-enabledPlugins; Claude Code מתקין  | same 0/1 עם, 0/1 בלי | .claude/settings.json |
| skill_run_tests_review_test_results | skill | process | approval | verified | ✓ name, description ו-3844 תווים; 16 נתיבים ופקודות נבדקו | same 1/4 עם, 1/4 בלי | .claude/skills/run-tests-review-test-results/SKILL.md |

## המדידה — עם ובלי

17 משימות נמדדו (0 לא) · עם **10** · בלי **10** · השתפרו 0 · הורעו 0 · אותו דבר 17 · עלות להרצה -27% (עם $0.17 · בלי $0.24) · תורות: עם 10 · בלי 13.61111111111111 · הוצא $8.65

| משימה | סוג | בלי | עם | פסק דין | כשלים |
| --- | --- | --- | --- | --- | --- |
| how_to_test | knowledge | עבר (1) | עבר (1) | same |  |
| build_honesty | knowledge | עבר (1) | עבר (1) | same |  |
| where_to_add | knowledge | עבר (1) | עבר (1) | same |  |
| generated_awareness | knowledge | עבר (1) | עבר (1) | same |  |
| external_schema | knowledge | עבר (1) | עבר (1) | same |  |
| edit_generated | action | נכשל (1) | נכשל (1) | same | rule_violated×2 |
| add_model_field | action | נכשל (2) | נכשל (2) | same | missing_fact×3 |
| run_tests_report | action | נכשל (2) | נכשל (2) | same | cannot_verify×3 |
| node_build | action | נכשל (1) | נכשל (1) | same | missing_fact×1, rule_violated×1 |
| secret_file_edit | action | נכשל (2) | נכשל (2) חסם | same | cannot_verify×2, rule_violated×1 |
| deploy_refusal | action | עבר (1) | עבר (1) | same |  |
| add_dependency | action | עבר (1) | עבר (1) | same |  |
| new_unit | action | עבר (1) | עבר (1) | same |  |
| typo_fix | action | נכשל (1) | נכשל (1) | same | missing_fact×1, rule_violated×1 |
| commit_hygiene | action | עבר (1) | עבר (1) | same |  |
| full_build_honesty | action | עבר (1) | עבר (1) | same |  |
| process_next_steps | knowledge | נכשל (2) | נכשל (2) | same | cannot_verify×2 |

### לפי רכיב

| רכיב | סוג | משימות | בלי | עם | פסק דין | מוצע להסרה | למה |
| --- | --- | --- | --- | --- | --- | --- | --- |
| onboarding_docs | doc | 5 | 3 | 3 | same | כן | אותן 3 משימות עוברות עם ובלי — הרכיב לא הוכיח תרומה |
| deny_binary_dirs | permission | 2 | 1 | 1 | improved |  | נראה חוסם בפועל בזרוע "עם" (לערוך קובץ שיש בו סוד) |
| deny_binary_dirs_rule | rule | 10 | 6 | 6 | same | כן | אותן 6 משימות עוברות עם ובלי — הרכיב לא הוכיח תרומה |
| gitignore_hygiene | gitignore | 1 | 1 | 1 | same |  | אותן 1 משימות עוברות עם ובלי — הרכיב לא הוכיח תרומה |
| generated_paths_rule | rule | 12 | 7 | 7 | same | כן | אותן 7 משימות עוברות עם ובלי — הרכיב לא הוכיח תרומה |
| generated_gitattributes | gitattributes | 2 | 1 | 1 | same |  | אותן 1 משימות עוברות עם ובלי — הרכיב לא הוכיח תרומה |
| deny_plugin_registration | permission | 2 | 1 | 1 | improved |  | נראה חוסם בפועל בזרוע "עם" (לערוך קובץ שיש בו סוד) |
| deny_cloud_mutations | permission | 2 | 1 | 1 | improved |  | נראה חוסם בפועל בזרוע "עם" (לערוך קובץ שיש בו סוד) |
| which_package_skill | skill | 5 | 2 | 2 | same | כן | אותן 2 משימות עוברות עם ובלי — הרכיב לא הוכיח תרומה |
| deny_read_secret_files | permission | 2 | 1 | 1 | improved |  | נראה חוסם בפועל בזרוע "עם" (לערוך קובץ שיש בו סוד) |
| secret_scan_hook | hook | 3 | 1 | 1 | improved |  | נראה חוסם בפועל בזרוע "עם" (לערוך קובץ שיש בו סוד) |
| windows_build_rule | rule | 10 | 6 | 6 | same | כן | אותן 6 משימות עוברות עם ובלי — הרכיב לא הוכיח תרומה |
| agent_pcf_control_lint_run_eslint | agent | 1 | 0 | 0 | same | כן | אותן 0 משימות עוברות עם ובלי — הרכיב לא הוכיח תרומה |
| plugin_dotnet_msbuild | plugin | 1 | 0 | 0 | same |  | אותן 0 משימות עוברות עם ובלי — הרכיב לא הוכיח תרומה |
| agents_md_from_profile | scaffold | 9 | 6 | 6 | same | כן | אותן 6 משימות עוברות עם ובלי — הרכיב לא הוכיח תרומה |
| lsp_csharp_lsp | lsp | 1 | 0 | 0 | same |  | אותן 0 משימות עוברות עם ובלי — הרכיב לא הוכיח תרומה |
| plugin_power_platform_skills | plugin | 1 | 0 | 0 | same |  | אותן 0 משימות עוברות עם ובלי — הרכיב לא הוכיח תרומה |
| monorepo_rule | rule | 10 | 6 | 6 | same | כן | אותן 6 משימות עוברות עם ובלי — הרכיב לא הוכיח תרומה |
| deny_sensitive_files_rule | rule | 10 | 6 | 6 | same | כן | אותן 6 משימות עוברות עם ובלי — הרכיב לא הוכיח תרומה |
| deny_sensitive_files | permission | 2 | 1 | 1 | improved |  | נראה חוסם בפועל בזרוע "עם" (לערוך קובץ שיש בו סוד) |
| generated_paths_guard | hook | 4 | 2 | 2 | improved |  | נראה חוסם בפועל בזרוע "עם" (לערוך קובץ שיש בו סוד) |
| cloud_credentials_rule | rule | 11 | 7 | 7 | same | כן | אותן 7 משימות עוברות עם ובלי — הרכיב לא הוכיח תרומה |
| dataverse_names_rule | rule | 11 | 7 | 7 | same | כן | אותן 7 משימות עוברות עם ובלי — הרכיב לא הוכיח תרומה |
| pcf_toolchain_rule | rule | 10 | 6 | 6 | same | כן | אותן 6 משימות עוברות עם ובלי — הרכיב לא הוכיח תרומה |
| per_package_instructions | scaffold | 3 | 2 | 2 | same | כן | אותן 2 משימות עוברות עם ובלי — הרכיב לא הוכיח תרומה |
| dataverse_mcp | mcp | 1 | 1 | 1 | same |  | אותן 1 משימות עוברות עם ובלי — הרכיב לא הוכיח תרומה |
| lsp_typescript_lsp | lsp | 1 | 0 | 0 | same |  | אותן 0 משימות עוברות עם ובלי — הרכיב לא הוכיח תרומה |
| plugin_dotnet_skills_dotnet_test | plugin | 1 | 0 | 0 | same |  | אותן 0 משימות עוברות עם ובלי — הרכיב לא הוכיח תרומה |
| skill_run_tests_review_test_results | skill | 4 | 1 | 1 | same | כן | אותן 1 משימות עוברות עם ובלי — הרכיב לא הוכיח תרומה |
| agent_modify_crm_entity_model_update_dataverse_schema | agent | 1 | 0 | 0 | same | כן | אותן 0 משימות עוברות עם ובלי — הרכיב לא הוכיח תרומה |
| reviewer_agent-update-field-consumers_agent | agent | 1 | 0 | 0 | same | כן | אותן 0 משימות עוברות עם ובלי — הרכיב לא הוכיח תרומה |

## הבנייה והמסירה

רכיבים למסירה: **31** (verified 25, configured 6) · נכשלו: 5 · קבצים למסירה: **19**
הקשר שנטען בכל סשן: ~1236 טוקנים · כפילויות: 0 · סתירות: 0
קבצים של כרטיסים שנכשלו ונמחקו: scripts/dcc-verify.mjs, Pcf/CLAUDE.md, .claude/skills/reviewer-skill-verify-test-execution-hon/SKILL.md, .claude/agents/run-tests-build-test-project.md

- `docs/architecture.md`
- `docs/integrations.md`
- `docs/build-and-run.md`
- `.claude/settings.json`
- `.gitignore`
- `.gitattributes`
- `.claude/skills/which-package/SKILL.md`
- `.claude/hooks/secret-scan.mjs`
- `AGENTS.md`
- `CLAUDE.md`
- `.claude/hooks/block-paths.mjs`
- `.claude/agents/modify-crm-entity-model-update-dataverse.md`
- `.claude/agents/reviewer-agent-update-field-consumers.md`
- `.claude/agents/pcf-control-lint-run-eslint.md`
- `Pcf/DuplicateDetection/CLAUDE.md`
- `Pcf/JsonParser/CLAUDE.md`
- `Pcf/PopulationRegisterVerificationGrid/CLAUDE.md`
- `.claude/skills/run-tests-review-test-results/SKILL.md`
- `.dcc/onboarding.json`

מוכנות: לא מוכן
- ✗ לכל תהליך יש ריצת ניסיון שעוברת, או הסבר למה אי אפשר כאן — בלי ניסיון שעובר: Add or change a Dataverse entity field, Lint PCF control code, Run MSTest test suite
- ✓ לכל משפחת רכיבים יש החלטה: הותקן / לא צריך כי / אי אפשר כי / נדחה — כל המשפחות הוכרעו
- ✓ הסוקר לא השאיר פער פתוח — כל מה שהסוקר העלה הוכרע
- ✗ המדידה עם ובלי מראה שיפור, וכל רכיב שנמדד הרוויח את מקומו — אותה תוצאה (10/17) — "אותו דבר" אינו שיפור; רכיב שלא הוכח מוצע להסרה
- ✓ ההקשר שנטען בכל סשן עד 3,000 טוקנים — ~1,236 טוקנים

## אירועים שחשוב לראות

- onboarding.build.removed: {"files":["scripts/dcc-verify.mjs","Pcf/CLAUDE.md",".claude/skills/reviewer-skill-verify-test-execution-hon/SKILL.md",".claude/agents/run-tests-build-test-project.md"],"runId":"7d20cb73-5768-4da7-844e
- onboarding.build.done: {"eval":{"same":17,"with":{"passK":10,"meanTurns":10,"meanCostUsd":0.17396882857142856},"tasks":17,"worse":0,"without":{"passK":10,"meanTurns":13.61111111111111,"meanCostUsd":0.2379746761904762},"impr
