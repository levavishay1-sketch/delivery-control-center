import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PROMPT_USES, contractProblems, renderPrompt } from "./prompt-contract.ts";

/**
 * The library as the database ends up with it: the migrations that seed and
 * edit it, replayed in order from the SQL itself — the same text the database
 * gets. Understands the forms those migrations use: INSERT … VALUES ('key', …,
 * $p$body$p$, $p$he$p$|NULL); UPDATE … replace("body", $a$from$a$, $b$to$b$) …
 * WHERE "key" = 'k' (in place — every anchor must be there); UPDATE … "body" =
 * $p$…$p$, "body_he" = $p$…$p$ WHERE "key" = 'k' (whole); DELETE … WHERE "key" = 'k'.
 */
const dir = new URL("../../db/migrations/", import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith(".sql") && f >= "0040").sort();
const rows: Record<string, { body: string; he: string | null }> = {};
const missedAnchors: string[] = [];
const edited: string[] = [];
for (const f of files) {
  for (const stmt of readFileSync(new URL(f, dir), "utf8").split("--> statement-breakpoint")) {
    const where = stmt.match(/WHERE "key" (?:=|LIKE) '([^']+)'/)?.[1];
    if (/^\s*(--.*\n\s*)*INSERT INTO "prompt_template"/.test(stmt)) {
      const key = stmt.match(/VALUES \(\s*'([^']+)'/)![1]!;
      const [body, he] = [...stmt.matchAll(/\$p\$([\s\S]*?)\$p\$/g)].map((m) => m[1]!);
      rows[key] = { body: body!, he: he ?? null };
    } else if (/^\s*(--.*\n\s*)*DELETE FROM "prompt_template"/.test(stmt) && where) {
      delete rows[where];
    } else if (/^\s*(--.*\n\s*)*UPDATE "prompt_template"/.test(stmt) && where && !where.includes("%")) {
      const row = rows[where];
      if (!row) continue;
      const [bodyPart, hePart = ""] = stmt.split(/"body_he" =/);
      const whole = [...stmt.matchAll(/\$p\$([\s\S]*?)\$p\$/g)].map((m) => m[1]!);
      if (whole.length) { row.body = whole[0]!; row.he = whole[1] ?? row.he; edited.push(`${f}:${where}`); continue; }
      const apply = (part: string, field: "body" | "he") => {
        for (const m of part.matchAll(/\$a\$([\s\S]*?)\$a\$,\s*\$b\$([\s\S]*?)\$b\$/g)) {
          const text = row[field] ?? "";
          if (!text.includes(m[1]!)) missedAnchors.push(`${f}:${where}:${field}: ${m[1]!.slice(0, 50)}`);
          row[field] = text.split(m[1]!).join(m[2]!);
        }
      };
      apply(bodyPart!, "body");
      apply(hePart, "he");
      edited.push(`${f}:${where}`);
    }
  }
}

describe("renderPrompt", () => {
  it("fills values and leaves an unknown one visible", () => {
    expect(renderPrompt("a {{X}} b {{Y}}", { X: "1" })).toBe("a 1 b {{Y}}");
  });

  it("keeps a section only when its switch is on, and its opposite only when it is off", () => {
    const t = "{{#R}}in {{N}}{{/R}}{{^R}}no repo{{/R}}";
    expect(renderPrompt(t, { R: true, N: "trade" })).toBe("in trade");
    expect(renderPrompt(t, { R: false, N: "" })).toBe("no repo");
  });

  it("treats a non-empty text as on and an empty one as off", () => {
    expect(renderPrompt("x{{#T}} ({{T}}){{/T}}", { T: "title" })).toBe("x (title)");
    expect(renderPrompt("x{{#T}} ({{T}}){{/T}}", { T: "  " })).toBe("x");
  });

  it("opens a section inside another", () => {
    expect(renderPrompt("{{#A}}a{{#B}}b{{/B}}{{/A}}", { A: true, B: true })).toBe("ab");
    expect(renderPrompt("{{#A}}a{{#B}}b{{/B}}{{/A}}", { A: true, B: false })).toBe("a");
  });
});

describe("contractProblems", () => {
  it("has nothing to say about a row no code uses", () => {
    expect(contractProblems("nobody.uses.this", "{{WHATEVER}}")).toEqual([]);
  });

  it("names a missing value, an unknown one, an unclosed section and a missing answer field", () => {
    const p = contractProblems("insights.clusters", "{{FOO}} {{#BAR}} [{\"n\": 1, \"finding\": \"\"}]");
    expect(p.some((x) => x.includes("{{FOO}} לא מוכר"))).toBe(true);
    expect(p.some((x) => x.includes("{{#BAR}}"))).toBe(true);
    expect(p.some((x) => x.includes('"recommendation"'))).toBe(true);
    expect(contractProblems("breakdown.tasks", "no requirement here").some((x) => x.includes("{{REQUIREMENT}}"))).toBe(true);
  });
});

describe("the library as the migrations leave it", () => {
  it("has every edit land on text that is there", () => {
    expect(missedAnchors).toEqual([]);
    expect(edited.length).toBeGreaterThan(0);
  });

  it("holds every prompt the code uses, apart from the readiness rows that came before it — and nothing the code no longer uses", () => {
    const earlier = Object.keys(PROMPT_USES).filter((k) => k.startsWith("assess."));
    expect(Object.keys(rows).sort()).toEqual(Object.keys(PROMPT_USES).filter((k) => !earlier.includes(k)).sort());
  });

  it("leaves each one, and its Hebrew version, whole — nothing its caller needs is missing", () => {
    for (const [key, row] of Object.entries(rows)) {
      expect(contractProblems(key, row.body), key).toEqual([]);
      if (row.he) {
        // The Hebrew version is only read, never parsed: it must carry the same values, not the English answer fields.
        expect(contractProblems(key, row.he).filter((p) => p.includes("{{")), `${key} (Hebrew)`).toEqual([]);
      }
    }
  });

  it("develops without reporting checks, and says what the branch holds of what it depends on", () => {
    const body = rows["implement.task"]!.body;
    const vars = { INSTRUCTION: "do it", APPETITE: "small", CONTEXT: "ctx", SHORT_TITLE: "", AFFECTED_PATHS: "" };
    const plain = renderPrompt(body, vars);
    expect(plain).not.toContain('"checks"');
    expect(plain).toContain("3. Tests: add tests for the logic you added or changed");
    expect(plain).toContain("Appetite: small\n\nCONTEXT");
    expect(renderPrompt(body, { ...vars, BUILT_ON: "#2 (base)" })).toContain("BUILT ON — this branch starts from the branch of a task this one depends on, which is not in the default branch yet: #2 (base).");
    expect(renderPrompt(body, { ...vars, MISSING: "#3 (later)" })).toContain("NOT HERE YET — this task depends on work that is not in this branch: #3 (later).");
    for (const t of [plain]) expect(t).not.toMatch(/\{\{/);
  });

  it("runs the checks with no write access, and asks why each one that failed did", () => {
    const run = renderPrompt(rows["checks.run"]!.body, { INTENT: "B", CHANGED_FILES: "b.txt", CONTEXT: "ctx", CHECKS: "#3 [build]: build it", MISSING: "#1 (A)" });
    expect(run).toContain("You must NOT change, create or delete any file");
    expect(run).toContain("#3 [build]: build it");
    expect(run).toContain("It was developed WITHOUT work it depends on, which is not in this branch: #1 (A).");
    expect(run).toContain('"environment"');
    expect(run).not.toMatch(/\{\{/);
  });

  it("gives each check DCC adds its own instruction, with or without compiled projects", () => {
    expect(renderPrompt(rows["check.build"]!.body, { COMPILED: "Alt.Crm.Plugins" })).toContain("הפרויקטים לבנייה: Alt.Crm.Plugins.");
    expect(renderPrompt(rows["check.build"]!.body, { COMPILED: "" })).toContain("לא פורטו פרויקטים מתקמפלים");
    for (const k of ["check.tests", "check.regression", "check.e2e"]) expect(renderPrompt(rows[k]!.body, { PATHS: "a.cs" })).not.toMatch(/\{\{/);
  });

  it("tells the breakdown what DCC adds by itself, and whether it has the code", () => {
    const b = rows["breakdown.tasks"]!.body;
    expect(b).toContain("DCC itself adds a build check, a tests check and a regression check under every leaf task");
    expect(renderPrompt(b, { HAS_REPO: true, REPO_NAME: "trade", REQUIREMENT: "r" })).toContain("You are in the repository (trade)");
    expect(renderPrompt(b, { HAS_REPO: false, REPO_NAME: "", REQUIREMENT: "r" })).toContain("No code checkout available.");
  });
});
