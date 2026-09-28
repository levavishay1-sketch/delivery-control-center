#!/usr/bin/env node
/**
 * One markdown report from a run's saved view (`onboard-repo.mjs` writes
 * <name>.view.json): what the process diagnosed, proposed, built, measured
 * and would deliver — the record a research round keeps under docs/research.
 *
 *   node scripts/research/report-run.mjs <name>.view.json [<name>.events.json] > docs/research/2026-09-onboarding-<name>.md
 */
import { readFileSync, existsSync } from "node:fs";

const viewPath = process.argv[2];
if (!viewPath) { console.error("usage: report-run.mjs <view.json> [<events.json>]"); process.exit(2); }
const v = JSON.parse(readFileSync(viewPath, "utf8"));
const events = process.argv[3] && existsSync(process.argv[3]) ? JSON.parse(readFileSync(process.argv[3], "utf8")) : (v.events ?? []);
const usd = (n) => (typeof n === "number" ? `$${n.toFixed(2)}` : "—");
const pct = (n) => (typeof n === "number" ? `${n >= 0 ? "+" : ""}${Math.round(n * 100)}%` : "—");
const step = (k) => v.steps.find((s) => s.stepKey === k);
const raw = v.profile?.raw ?? {};
const cards = v.components ?? [];
const deliverable = cards.filter((c) => c.status === "verified" || c.status === "configured");
const files = step("deliver")?.result?.files ?? v.build?.files ?? [];
const ev = v.trials?.eval ?? null;
const t = ev?.totals ?? null;
const joint = v.build?.jointCheck ?? null;
const byStep = v.cost?.byStep ?? [];
const out = [];
const H = (s) => out.push("", s, "");
const row = (...c) => out.push(`| ${c.map((x) => String(x ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ")).join(" | ")} |`);

out.push(`# הטמעה על ${v.repo?.name ?? "?"} — הרצה ${String(v.run?.id ?? "").slice(0, 8)}`);
out.push("");
out.push(`מצב: **${v.run?.status}** · צעד: ${v.run?.currentStepKey ?? "—"} · מדרגה: ${v.automation?.level} · עלות כוללת: **${usd(v.cost?.totalCostUsd)}** (${v.cost?.calls ?? 0} קריאות)`);

H("## הצעדים");
row("צעד", "מצב", "עלות", "קריאות"); row("---", "---", "---", "---");
for (const s of v.steps) { const c = byStep.find((b) => b.stepKey === s.stepKey); row(s.stepKey, s.status, usd(c?.costUsd ?? 0), c?.calls ?? 0); }

H("## מה האבחון ראה");
const env = raw.environment?.tools ?? {};
out.push(`- סטאק: ${(v.profile?.tags ?? []).join(", ") || "—"}`);
out.push(`- קבצים: ${raw.size?.files ?? raw.files ?? "—"} · חבילות: ${raw.monorepo?.packages?.length ?? 0}${raw.monorepo?.packages_truncated ? " (קטום)" : ""}`);
out.push(`- כלים על המכונה: ${Object.entries(env).filter(([, x]) => x).map(([k]) => k).join(", ") || "אין"}`);
out.push(`- בדיקות: ${(raw.tests?.frameworks ?? []).join(", ") || "—"} · פרויקטי בדיקה ב-git: ${raw.tests?.projects?.length ?? 0} · פקודות: ${(raw.tests?.commands ?? []).join(" · ") || "—"}`);
out.push(`- build: ${(raw.build?.commands ?? []).join(" · ") || "—"} · CI: ${raw.ci?.present ? (raw.ci.systems ?? []).join(", ") || "כן" : "אין"}`);
out.push(`- מג'ונרט: ${(raw.generated_code?.paths ?? []).length} נתיבים${raw.generated_code?.header_files?.length ? ` + ${raw.generated_code.header_files.length} קבצים לפי כותרת` : ""} · קבצים רגישים: ${(raw.secrets?.sensitive_files ?? []).length} · סודות: ${(raw.secrets?.files ?? []).length}`);
out.push(`- תיעוד קיים: ${raw.docs?.readme ? "README" : "—"}${raw.docs?.contributing?.length ? ", CONTRIBUTING" : ""}${raw.ai_config?.present ? " · כבר יש הגדרות AI" : ""}`);

H("## הראיון");
for (const a of v.interview?.answers ?? []) out.push(`- ${a.key}: ${a.answer ?? a.value ?? "—"}${a.assumed ? " (ברירת מחדל)" : ""}`);

H("## הכרטיסים");
const byStatus = {};
for (const c of cards) byStatus[c.status] = (byStatus[c.status] ?? 0) + 1;
out.push(`${cards.length} כרטיסים: ${Object.entries(byStatus).map(([k, n]) => `${k} ${n}`).join(" · ")}`);
out.push("");
row("מפתח", "סוג", "מקור", "קבוצה", "מצב", "אימות", "מדידה", "קבצים"); row("---", "---", "---", "---", "---", "---", "---", "---");
for (const c of cards) row(c.key, c.kind, c.source, c.group, c.status + (c.declineReason ? ` (${c.declineReason.slice(0, 60)})` : ""), c.validation ? `${c.validation.passed === true ? "✓" : c.validation.passed === false ? "✗" : "·"} ${c.validation.detail.slice(0, 80)}` : "", c.delta ? `${c.delta.verdict} ${c.delta.after}/${c.delta.total} עם, ${c.delta.before}/${c.delta.total} בלי` : "", (c.files ?? []).join(", "));

H("## המדידה — עם ובלי");
if (t) {
  out.push(`${t.measured} משימות נמדדו (${t.unmeasured} לא) · עם **${t.with.passK}** · בלי **${t.without.passK}** · השתפרו ${t.improved} · הורעו ${t.worse} · אותו דבר ${t.same} · עלות להרצה ${pct(t.costChange)} (עם ${usd(t.with.meanCostUsd)} · בלי ${usd(t.without.meanCostUsd)}) · תורות: עם ${t.with.meanTurns ?? "—"} · בלי ${t.without.meanTurns ?? "—"} · הוצא ${usd(t.spentUsd)}`);
  out.push("");
  row("משימה", "סוג", "בלי", "עם", "פסק דין", "כשלים"); row("---", "---", "---", "---", "---", "---");
  for (const x of ev.tasks) row(x.key, x.kind, `${x.without.passK === null ? "—" : x.without.passK ? "עבר" : "נכשל"} (${x.without.runs ?? 0})`, `${x.with.passK === null ? "—" : x.with.passK ? "עבר" : "נכשל"} (${x.with.runs ?? 0})${x.with.blocked ? " חסם" : ""}`, x.verdict, Object.entries(x.failureKinds ?? {}).map(([k, n]) => `${k}×${n}`).join(", "));
  out.push("");
  out.push("### לפי רכיב");
  out.push("");
  row("רכיב", "סוג", "משימות", "בלי", "עם", "פסק דין", "מוצע להסרה", "למה"); row("---", "---", "---", "---", "---", "---", "---", "---");
  for (const c of ev.components ?? []) row(c.key, c.kind, c.tasks.length, c.delta.before, c.delta.after, c.delta.verdict, c.removalProposed ? "כן" : "", c.why_he);
} else out.push("לא נמדד.");

H("## הבנייה והמסירה");
out.push(`רכיבים למסירה: **${deliverable.length}** (verified ${deliverable.filter((c) => c.status === "verified").length}, configured ${deliverable.filter((c) => c.status === "configured").length}) · נכשלו: ${cards.filter((c) => c.status === "failed").length} · קבצים למסירה: **${files.length}**`);
if (joint) out.push(`הקשר שנטען בכל סשן: ~${joint.alwaysLoadedTokens} טוקנים · כפילויות: ${joint.duplicates?.length ?? 0} · סתירות: ${joint.contradictions?.length ?? 0}`);
if (v.build?.removedFiles?.length) out.push(`קבצים של כרטיסים שנכשלו ונמחקו: ${v.build.removedFiles.join(", ")}`);
out.push("");
for (const f of files) out.push(`- \`${f}\``);
if (v.readiness) { out.push(""); out.push(`מוכנות: ${v.readiness.ready ? "מוכן" : "לא מוכן"}`); for (const i of v.readiness.items ?? []) out.push(`- ${i.ok ? "✓" : "✗"} ${i.title_he ?? i.title ?? i.key}${i.detail_he ? ` — ${i.detail_he}` : i.detail ? ` — ${i.detail}` : ""}`); }

H("## אירועים שחשוב לראות");
const interesting = events.filter((e) => /failed|removed|retry|stopped|capped|scan_applied|build\.done|trial\.stopped|component\.removed|build\.removed/.test(e.type));
for (const e of interesting.slice(0, 60)) out.push(`- ${e.type}: ${JSON.stringify(e.payload).slice(0, 200)}`);
if (!interesting.length) out.push("- אין");

console.log(out.join("\n"));
