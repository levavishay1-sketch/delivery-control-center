import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PROMPT_USES, contractProblems, renderPrompt } from "./prompt-contract.ts";

/** The rows the library migration seeds, read from the SQL itself — the same text the database gets. */
const seeded: Record<string, { body: string; he: string | undefined }> = {};
const sql = readFileSync(new URL("../../db/migrations/0040_every_prompt_in_the_library.sql", import.meta.url), "utf8");
for (const chunk of sql.split("--> statement-breakpoint")) {
  const key = chunk.match(/VALUES \(\s*'([^']+)'/)?.[1];
  if (!key) continue;
  const [body, he] = [...chunk.matchAll(/\$p\$([\s\S]*?)\$p\$/g)].map((m) => m[1]!);
  seeded[key] = { body: body!, he };
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

describe("the seeded library", () => {
  it("seeds every prompt the code uses, apart from the readiness rows that came before it", () => {
    const earlier = Object.keys(PROMPT_USES).filter((k) => k.startsWith("assess."));
    expect(Object.keys(seeded).sort()).toEqual(Object.keys(PROMPT_USES).filter((k) => !earlier.includes(k)).sort());
  });

  it("seeds each one, and its Hebrew version, whole — nothing its caller needs is missing", () => {
    for (const [key, row] of Object.entries(seeded)) {
      expect(contractProblems(key, row.body), key).toEqual([]);
      if (row.he) {
        // The Hebrew version is only read, never parsed: it must carry the same values, not the English answer fields.
        const he = contractProblems(key, row.he).filter((p) => p.includes("{{"));
        expect(he, `${key} (Hebrew)`).toEqual([]);
      }
    }
  });

  it("renders a task with checks, a task without, and a check — each whole and with no leftover markers", () => {
    const vars = { INSTRUCTION: "do it", APPETITE: "small", CONTEXT: "ctx", SHORT_TITLE: "", AFFECTED_PATHS: "" };
    const withChecks = renderPrompt(seeded["implement.task"]!.body, { ...vars, CHECKS: "#3: verify" });
    expect(withChecks).toContain("CHECKS TO ALSO PERFORM");
    expect(withChecks).toContain("#3: verify");
    expect(withChecks).toContain("6. Perform each numbered check");
    expect(withChecks).toContain('"checks": [{"seq"');
    const without = renderPrompt(seeded["implement.task"]!.body, { ...vars, CHECKS: "" });
    expect(without).not.toContain("CHECKS TO ALSO PERFORM");
    expect(without).not.toContain('"checks"');
    expect(without).toContain("Appetite: small\n\nCONTEXT");
    const check = renderPrompt(seeded["implement.check"]!.body, vars);
    expect(check).toContain("You are VERIFYING one thing");
    for (const t of [withChecks, without, check]) expect(t).not.toMatch(/\{\{/);
  });

  it("tells the breakdown whether it has the code", () => {
    const b = seeded["breakdown.tasks"]!.body;
    expect(renderPrompt(b, { HAS_REPO: true, REPO_NAME: "trade", REQUIREMENT: "r" })).toContain("You are in the repository (trade)");
    expect(renderPrompt(b, { HAS_REPO: false, REPO_NAME: "", REQUIREMENT: "r" })).toContain("No code checkout available.");
  });
});
