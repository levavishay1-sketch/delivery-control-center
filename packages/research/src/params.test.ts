import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BlockedError, emptyParams, loadParams, PARAMS, protocolIdOf, requireParams, STAGES, unsetBy, validateParams } from "./params.ts";
import { FROZEN_PROTOCOL, REPO_ROOT } from "./protocol.ts";
import { QUESTIONS } from "./questions.ts";

/** Parameter ids as the frozen protocol's registries (sections 12.1 and 12.2) list them. */
function protocolIds(): Set<string> {
  const text = readFileSync(path.join(REPO_ROOT, FROZEN_PROTOCOL.file), "utf8").replace(/\r\n/g, "\n");
  const ids = new Set<string>();
  for (const line of text.split("\n")) {
    const m = line.match(/^\| (U\d+|PP-\d+) \|/);
    if (m) ids.add(m[1]!);
  }
  return ids;
}

describe("the parameter registry", () => {
  it("covers exactly the open decisions of the frozen protocol, no more and no fewer", () => {
    const fromProtocol = protocolIds();
    const fromRegistry = new Set(PARAMS.map(protocolIdOf).filter((x): x is string => x !== null));
    expect([...fromRegistry].sort()).toEqual([...fromProtocol].sort());
    expect(fromProtocol.size).toBe(39 + 5);
  });

  it("gives every entry a known stage and a unique id; operational entries are marked OP-", () => {
    const ids = PARAMS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of PARAMS) expect(STAGES).toContain(p.stage);
    for (const p of PARAMS.filter((x) => x.id.startsWith("OP-"))) expect(p.protocolId).toBeUndefined();
  });

  it("every parameter a pilot question depends on exists", () => {
    const ids = new Set(PARAMS.map((p) => p.id));
    for (const q of QUESTIONS) for (const id of [...q.needs, ...q.parts.flatMap((x) => x.needs)]) expect(ids, `${q.id} needs ${id}`).toContain(id);
  });
});

describe("the parameters file", () => {
  it("in the repository is valid against the registry", () => {
    expect(() => loadParams()).not.toThrow();
  });

  it("rejects an unknown id, a missing id, and a SET value without who, when and why", () => {
    const base = emptyParams();
    expect(validateParams({ entries: { ...base.entries, U99: { state: "UNSET" } } }).ok).toBe(false);
    const missing = { entries: { ...base.entries } };
    delete missing.entries.U12;
    expect(validateParams(missing).ok).toBe(false);
    const noBasis = { entries: { ...base.entries, U12: { state: "SET", value: "x", decidedBy: "user", decidedAt: "2026-09-29", basis: "" } } };
    const r = validateParams(noBasis);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join()).toMatch(/U12: SET without basis/);
  });
});

describe("requireParams", () => {
  it("fails closed, naming every UNSET id", () => {
    const p = emptyParams();
    try {
      requireParams(p, ["U12", "U23-pilot"], "an agent run");
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(BlockedError);
      expect((e as BlockedError).missing).toEqual(["U12", "U23-pilot"]);
    }
  });

  it("returns the values once they are SET, and refuses an id outside the registry", () => {
    const p = emptyParams();
    p.entries.U12 = { state: "SET", value: { model: "m", claudeCode: "v" }, decidedBy: "user", decidedAt: "2026-09-29", basis: "test" };
    expect(requireParams(p, ["U12"], "x")).toEqual({ U12: { model: "m", claudeCode: "v" } });
    expect(() => requireParams(p, ["U99"], "x")).toThrow(/not in the registry/);
  });

  it("lists what is still open by a stage, cumulatively", () => {
    const p = emptyParams();
    expect(unsetBy(p, "before-pilot").map((x) => x.id)).toEqual(["U12", "U13", "U17", "U23-pilot", "U37", "OP-1"]);
    expect(unsetBy(p, "before-deployment").length).toBe(PARAMS.length);
  });
});
