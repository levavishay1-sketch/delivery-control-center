import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { appendEvidence, canonical, GENESIS, readEvidence, verifyChain, type EvidenceInput } from "./evidence.ts";
import { checkProtocol, FROZEN_PROTOCOL, REPO_ROOT, textSha256 } from "./protocol.ts";

const dirs: string[] = [];
const tmp = () => { const d = mkdtempSync(path.join(tmpdir(), "dcc-evidence-")); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

const rec = (n: number): EvidenceInput => ({
  kind: "test", question: "F2", status: "PASS", protocolSha256: FROZEN_PROTOCOL.sha256, paramsSha256: "p",
  startedAt: `2026-09-29T00:00:0${n}Z`, finishedAt: `2026-09-29T00:00:0${n}Z`, data: { n, b: [1, { z: 1, a: 2 }] },
});

const CR = String.fromCharCode(13);
const LF = String.fromCharCode(10);

describe("canonical JSON", () => {
  it("does not depend on key order, and drops undefined fields", () => {
    expect(canonical({ b: 1, a: { d: 2, c: [3] } })).toBe(canonical({ a: { c: [3], d: 2 }, b: 1 }));
    expect(canonical({ a: 1, x: undefined })).toBe('{"a":1}');
  });
});

describe("the evidence log", () => {
  it("chains records from GENESIS and verifies intact", () => {
    const d = tmp();
    const first = appendEvidence(d, rec(1));
    appendEvidence(d, rec(2));
    appendEvidence(d, rec(3));
    expect(first.prev).toBe(GENESIS);
    expect(first.seq).toBe(0);
    expect(readEvidence(d).map((r) => r.seq)).toEqual([0, 1, 2]);
    expect(verifyChain(d)).toEqual({ ok: true, records: 3 });
  });

  it("finds an edited record, a removed record and a reordered log", () => {
    const d = tmp();
    for (const n of [1, 2, 3]) appendEvidence(d, rec(n));
    const file = path.join(d, "evidence.jsonl");
    const original = readFileSync(file, "utf8").split(LF).filter(Boolean);
    const write = (ls: (string | undefined)[]) => writeFileSync(file, ls.join(LF) + LF);

    write([original[0], original[1]!.replace('"status":"PASS"', '"status":"FAIL"'), original[2]]);
    expect(verifyChain(d)).toMatchObject({ ok: false, line: 2 });

    write([original[0], original[2]]);
    expect(verifyChain(d)).toMatchObject({ ok: false, line: 2 });

    write([original[1], original[0], original[2]]);
    expect(verifyChain(d)).toMatchObject({ ok: false, line: 1 });
  });

  it("an empty campaign verifies with zero records", () => {
    expect(verifyChain(tmp())).toEqual({ ok: true, records: 0 });
  });
});

describe("the frozen protocol check", () => {
  it("the protocol in the repository is the Freeze 1 text", () => {
    expect(checkProtocol()).toEqual({ ok: true, sha256: FROZEN_PROTOCOL.sha256 });
  });

  it("hashes LF and CRLF checkouts the same, and reports any other change", () => {
    expect(textSha256(`a${CR}${LF}b${CR}${LF}`)).toBe(textSha256(`a${LF}b${LF}`));
    const root = tmp();
    const target = path.join(root, FROZEN_PROTOCOL.file);
    mkdirSync(path.dirname(target), { recursive: true });
    const text = readFileSync(path.join(REPO_ROOT, FROZEN_PROTOCOL.file), "utf8").split(CR).join("");
    writeFileSync(target, text.split(LF).join(CR + LF));
    expect(checkProtocol(root).ok).toBe(true);
    writeFileSync(target, `${text}${LF}extra`);
    expect(checkProtocol(root)).toMatchObject({ ok: false });
  });
});
