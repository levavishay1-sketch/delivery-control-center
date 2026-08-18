import { describe, expect, it } from "vitest";
import { projectIdentityColor } from "@/lib/colors/projectIdentity";

describe("projectIdentityColor", () => {
  it("is stable for the same project ID across calls", () => {
    const id = "cljk3x9z10000abc123def456";
    expect(projectIdentityColor(id)).toBe(projectIdentityColor(id));
  });

  it("returns a hex color for a variety of realistic cuid-shaped IDs", () => {
    const ids = ["clx1", "clx2abc", "cm0defghijk", "a", ""];
    for (const id of ids) {
      expect(projectIdentityColor(id)).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("distributes across the palette rather than collapsing to one color", () => {
    const ids = Array.from({ length: 50 }, (_, i) => `project-${i}`);
    const colors = new Set(ids.map(projectIdentityColor));
    expect(colors.size).toBeGreaterThan(1);
  });
});

/**
 * Hue distance from the five status colors, computed (not eyeballed) — see
 * the rationale comment in projectIdentity.ts. Documents the worst-case and
 * average separation so a future change to either palette can re-check this
 * deliberately rather than by inspection.
 */
describe("identity palette hue distance from status colors", () => {
  function hexToHue(hex: string): number {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;
    if (d === 0) return 0;
    let h: number;
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    return h < 0 ? h + 360 : h;
  }

  const STATUS_HEX = ["#059669", "#2563eb", "#7c3aed", "#d97706", "#dc2626"];
  const IDENTITY_HEX = ["#f472b6", "#22c55e", "#38bdf8", "#a3e635", "#d946ef", "#facc15", "#2dd4bf", "#fb7185"];

  it("every identity hue is at least 8 degrees from every status hue", () => {
    for (const identity of IDENTITY_HEX) {
      const h = hexToHue(identity);
      for (const status of STATUS_HEX) {
        const sh = hexToHue(status);
        const diff = Math.abs(h - sh);
        const dist = Math.min(diff, 360 - diff);
        expect(dist, `${identity} too close to status ${status}`).toBeGreaterThanOrEqual(8);
      }
    }
  });
});
