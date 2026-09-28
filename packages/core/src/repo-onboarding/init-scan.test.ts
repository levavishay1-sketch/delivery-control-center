import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { appendBlock, buildComponents, previewAgentsMd } from "./build.ts";
import { buildOrder, cardFromSeed } from "./components.ts";
import { draftPaths, fileKind, insideCopy, parseInitScan, renderDraft, seedsFromScan, withScanNote, type InitScan } from "./init-scan.ts";
import { writtenPaths } from "./transcript.ts";
import { scratchDir } from "./verify.ts";
import type { Component, RepoProfile } from "./types.ts";

const DIAG = fileURLToPath(new URL("../../../../docs/research/sources/onboarding-v2/repos/diagnosis/", import.meta.url));
const profile = JSON.parse(readFileSync(`${DIAG}altshuler_trade.json`, "utf8")) as RepoProfile;

const item = (o: Partial<InitScan["items"][number]>): InitScan["items"][number] => ({
  decision: "take", form: "line", title: "t", target: "AGENTS.md", heading: null, text: "x", origin: "theirs",
  need: "", evidence: "", alternative: "", verify: "", cost: "", question: null, replaces: [], ...o,
});
const scanOf = (items: InitScan["items"]): InitScan => ({ verdict: "partial", summary: "", compare: [], items, dropOurs: [], reject: [] });

describe("the draft", () => {
  it("is what the session wrote plus the changed instruction files, never DCC's own", () => {
    expect(draftPaths(["src/x.ts", ".dcc/profile.json"], [{ path: "AGENTS.md" }, { path: "pkg/CLAUDE.md" }, { path: ".claude/skills/a/SKILL.md" }, { path: "README.md" }]))
      .toEqual([".claude/skills/a/SKILL.md", "AGENTS.md", "pkg/CLAUDE.md", "src/x.ts"]);
  });

  it("reads the files the session wrote from its transcript, relative to the copy", () => {
    const dir = scratchDir();
    const t = path.join(dir, "t.jsonl");
    const use = (name: string, input: Record<string, string>) => JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name, input }] } });
    writeFileSync(t, [use("Write", { file_path: path.join(dir, "AGENTS.md") }), use("Edit", { file_path: "docs/a.md" }), use("Read", { file_path: path.join(dir, "x.md") }), use("Write", { file_path: "/elsewhere/y.md" }), ""].join("\n"));
    expect(writtenPaths(t, dir)).toEqual(["AGENTS.md", "docs/a.md"]);
  });

  it("shows a new file whole, a changed one before and after, and names a deleted one", () => {
    const text = renderDraft([{ path: "AGENTS.md", before: null, after: "new" }, { path: "CLAUDE.md", before: "old", after: "changed" }, { path: "x.md", before: "gone", after: null }]);
    expect(text).toContain("AGENTS.md (NEW");
    expect(text).toMatch(/CLAUDE\.md \(CHANGED[\s\S]*old[\s\S]*changed/);
    expect(text).toContain("x.md (DELETED");
    expect(renderDraft([{ path: "big.md", before: null, after: "a".repeat(30_000) }], 1000, 5000)).toContain("more characters not shown");
  });
});

describe("the editor's answer", () => {
  it("reads the JSON inside a fence and drops what is malformed", () => {
    const raw = "here:\n```json\n" + JSON.stringify({
      verdict: "merge", summary: "s",
      items: [{ decision: "take", form: "line", text: "- Use `npm test`", title: "t" }, { decision: "maybe", form: "line", text: "x" }, { decision: "ask", form: "section", text: "", title: "empty" }],
      drop_ours: [{ key: "a", why: "w" }, { why: "no key" }], reject: [{ what: "generic", why: "g" }],
    }) + "\n```";
    const s = parseInitScan(raw);
    expect(s.verdict).toBe("merge");
    expect(s.items).toHaveLength(1);
    expect(s.items[0]!.question).toBeNull();
    expect(s.dropOurs).toEqual([{ key: "a", why: "w" }]);
    expect(s.reject).toHaveLength(1);
  });

  it("falls back to a verdict that matches what it took, and refuses an answer with no JSON", () => {
    expect(parseInitScan(JSON.stringify({ items: [] })).verdict).toBe("keep_ours");
    expect(parseInitScan(JSON.stringify({ items: [{ decision: "check", form: "line", text: "x" }] })).verdict).toBe("partial");
    expect(() => parseInitScan("I could not decide")).toThrow();
  });
});

describe("from what it takes to cards", () => {
  const dir = scratchDir();
  mkdirSync(path.join(dir, "src"), { recursive: true });
  writeFileSync(path.join(dir, "src/app.ts"), "x");
  const ours = [{ key: "agents_md", title_he: "AGENTS.md מהאבחון" }];

  it("takes only files DCC can build and verify as a kind", () => {
    expect(fileKind(".claude/skills/release/SKILL.md")).toBe("skill");
    expect(fileKind(".claude/agents/reviewer.md")).toBe("agent");
    expect(fileKind("packages/api/CLAUDE.md")).toBe("doc");
    expect(fileKind(".claude/settings.json")).toBeNull();
    expect(fileKind(".mcp.json")).toBeNull();
    expect(fileKind("AGENTS.md")).toBeNull();
  });

  it("never lets a path the model wrote leave the copy", () => {
    for (const p of ["../../.claude/CLAUDE.md", "../other/CLAUDE.md", "docs/../../../tmp/x.md", "/etc/CLAUDE.md", "C:/x/CLAUDE.md", "a\\CLAUDE.md", "./CLAUDE.md", "a//CLAUDE.md"]) expect(fileKind(p), p).toBeNull();
    expect(insideCopy("docs/v1..v2.md")).toBe(true);
  });

  it("makes one card of the same text given twice", () => {
    const scan = scanOf([item({ text: "Use `npm test`" }), item({ text: "- Use `npm test`" })]);
    expect(seedsFromScan({ scan, dir, knownCommands: [], ours, inBaseline: () => false }).seeds).toHaveLength(1);
  });

  it("makes a card per item with its reasoning, the same key for the same text, and says what it refused", () => {
    const scan = scanOf([
      item({ text: "- Handlers live in `src/app.ts`", need: "the trial missed it", evidence: "src/app.ts", replaces: ["agents_md", "not_a_card"] }),
      item({ form: "file", target: ".claude/settings.json", text: "{}" }),
      item({ form: "file", target: ".claude/skills/x/SKILL.md", text: "---\nname: x\n---" }),
      item({ decision: "ask", form: "line", text: "Deploy to the client's environment after merge", question: "מותר לפרוס?" }),
    ]);
    const a = seedsFromScan({ scan, dir, knownCommands: [], ours, inBaseline: (p) => p === ".claude/skills/x/SKILL.md" });
    const b = seedsFromScan({ scan, dir, knownCommands: [], ours, inBaseline: () => false });
    expect(a.seeds).toHaveLength(2);
    expect(a.refused.map((r) => r.why).join(" ")).toMatch(/settings\.json[\s\S]*כבר קיים/);
    const line = a.seeds[0]!;
    expect(line.kind).toBe("rule");
    expect(line.source).toBe("init");
    expect(line.params.text).toBe("Handlers live in `src/app.ts`");
    expect(line.params.replaces).toEqual(["agents_md"]);
    expect(line.why_he).toContain("הצורך: the trial missed it");
    expect(line.why_he).toContain("מחליף את: AGENTS.md מהאבחון");
    expect(a.seeds[1]!.why_he).toContain("צריך החלטה שלך: מותר לפרוס?");
    expect(b.seeds.map((s) => s.key)).toEqual(expect.arrayContaining(a.seeds.map((s) => s.key)));
  });

  it("puts text that names paths the code does not have under not recommended", () => {
    const scan = scanOf([item({ form: "section", heading: "Layout", text: "- `src/nope/` has the api\n- `lib/missing.ts` too\n- `src/app.ts` is the entry" })]);
    const { seeds } = seedsFromScan({ scan, dir, knownCommands: [], ours, inBaseline: () => false });
    expect(seeds[0]!.notRecommended).toBe(true);
    expect(cardFromSeed(seeds[0]!, "reversible_auto").group).toBe("not_recommended");
  });

  it("notes a card of ours once, and takes the note off again", () => {
    const once = withScanNote("because X.", "duplicated by the draft");
    expect(withScanNote(once, "still duplicated")).toBe("because X. סריקת /init: still duplicated");
    expect(withScanNote(once, null)).toBe("because X.");
  });
});

describe("building what was taken", () => {
  it("appends a block as it is, blank lines and a second fence kept, once", () => {
    const dir = scratchDir();
    writeFileSync(path.join(dir, "AGENTS.md"), "# Repo\n\n```\na\n```\n");
    appendBlock(dir, "AGENTS.md", "## Run\n\n```\nnpm test\n```", "<!-- m -->");
    appendBlock(dir, "AGENTS.md", "## Run\n\n```\nnpm test\n```", "<!-- m -->");
    const text = readFileSync(path.join(dir, "AGENTS.md"), "utf8");
    expect(text.match(/## Run/g)).toHaveLength(1);
    expect(text.match(/```/g)).toHaveLength(4);
    expect(text).toContain("## Run\n\n```");
  });

  it("adds a section under a heading the file already has — the text is new, only the same block is skipped", () => {
    const dir = scratchDir();
    writeFileSync(path.join(dir, "AGENTS.md"), "# Repo\n\n## Verification\n\n- Build: `npm run build`\n");
    appendBlock(dir, "AGENTS.md", "## Verification\n\nRun the smoke test too.", "<!-- m -->");
    expect(readFileSync(path.join(dir, "AGENTS.md"), "utf8")).toContain("Run the smoke test too.");
  });

  it("builds the draft's cards after ours in the same family", () => {
    const c = (key: string, source: Component["source"]) => ({ ...cardFromSeed({ key, kind: "doc", family: "knowledge", title_he: key, why_he: "", what_he: "", source, sourceRef: null, risk: "reversible", verifyHow_he: "", params: {} }, "all_approval"), status: "approved" as const });
    expect(buildOrder([c("a_init", "init"), c("z_ours", "rule")]).map((x) => x.key)).toEqual(["z_ours", "a_init"]);
  });

  it("writes an approved section into AGENTS.md, imports it from CLAUDE.md, and checks its paths", async () => {
    const dir = scratchDir();
    mkdirSync(path.join(dir, "src"), { recursive: true });
    writeFileSync(path.join(dir, "src/app.ts"), "x");
    const seed = seedsFromScan({ scan: scanOf([item({ form: "section", heading: "Where things are", text: "The entry is `src/app.ts`." })]), dir, knownCommands: [], ours: [], inBaseline: () => false }).seeds[0]!;
    const card = { ...cardFromSeed(seed, "all_approval"), status: "approved" as const };
    const out = await buildComponents({ dir, repoName: "r", profile, cards: [card], processes: [], author: async () => "", log: () => {} });
    expect(out[0]!.status).toBe("verified");
    expect(readFileSync(path.join(dir, "AGENTS.md"), "utf8")).toContain("## Where things are\n\nThe entry is `src/app.ts`.");
    expect(existsSync(path.join(dir, "CLAUDE.md"))).toBe(true);
  });

  it("takes a section that fails its check out of AGENTS.md again, and never writes outside the copy", async () => {
    const dir = scratchDir();
    writeFileSync(path.join(dir, "AGENTS.md"), "# Ours\n");
    const approved = (text: string, extra: Record<string, unknown> = {}) => {
      const seed = seedsFromScan({ scan: scanOf([item({ form: "section", heading: "Where", text })]), dir, knownCommands: [], ours: [], inBaseline: () => false }).seeds[0]!;
      return { ...cardFromSeed({ ...seed, notRecommended: false }, "all_approval"), status: "approved" as const, params: { ...seed.params, ...extra } };
    };
    const [bad] = await buildComponents({ dir, repoName: "r", profile, cards: [approved("See `src/nope/a.ts`, `lib/nope.ts` and `x/nope.ts`.")], processes: [], author: async () => "", log: () => {} });
    expect(bad!.status).toBe("failed");
    expect(readFileSync(path.join(dir, "AGENTS.md"), "utf8")).toBe("# Ours\n");
    const [escape] = await buildComponents({ dir, repoName: "r", profile, cards: [approved("x", { template: "init-file", file: "../escaped.md" })], processes: [], author: async () => "", log: () => {} });
    expect(escape!.status).toBe("failed");
    expect(existsSync(path.join(dir, "..", "escaped.md"))).toBe(false);
  });

  it("previews our AGENTS.md from the cards not declined, leaving the draft's out", () => {
    const rule = (key: string, text: string, source: Component["source"], status: Component["status"]) => ({ ...cardFromSeed({ key, kind: "rule", family: "knowledge", title_he: key, why_he: "", what_he: "", source, sourceRef: null, risk: "reversible", verifyHow_he: "", params: { text } }, "all_approval"), status });
    const text = previewAgentsMd(scratchDir(), profile, "r", [rule("a", "keep generated code untouched", "rule", "proposed"), rule("b", "declined line", "rule", "declined"), rule("c", "from the draft", "init", "approved")]);
    expect(text).toContain("keep generated code untouched");
    expect(text).not.toContain("declined line");
    expect(text).not.toContain("from the draft");
  });
});
