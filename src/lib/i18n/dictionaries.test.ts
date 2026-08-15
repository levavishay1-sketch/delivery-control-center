import { describe, expect, it } from "vitest";
import { en } from "@/lib/i18n/en";
import { he } from "@/lib/i18n/he";

function collectPaths(obj: unknown, prefix = ""): string[] {
  if (typeof obj !== "object" || obj === null) return [prefix];
  return Object.entries(obj as Record<string, unknown>).flatMap(([key, value]) =>
    collectPaths(value, prefix ? `${prefix}.${key}` : key)
  );
}

describe("he.ts has no missing keys relative to en.ts", () => {
  it("every leaf path in en exists in he, and vice versa", () => {
    const enPaths = collectPaths(en).sort();
    const hePaths = collectPaths(he).sort();
    expect(hePaths).toEqual(enPaths);
  });

  it("no Hebrew string is left empty", () => {
    const hePaths = collectPaths(he);
    for (const path of hePaths) {
      const value = path.split(".").reduce<unknown>((acc, key) => (acc as Record<string, unknown>)[key], he);
      expect(typeof value === "string" && value.length > 0, `${path} is empty`).toBe(true);
    }
  });
});
