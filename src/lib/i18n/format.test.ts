import { describe, expect, it } from "vitest";
import { formatDate, formatMessage, formatNumber, pluralize } from "@/lib/i18n/format";

describe("formatMessage", () => {
  it("substitutes {token} placeholders", () => {
    expect(formatMessage("Owner: {name}", { name: "Alice" })).toBe("Owner: Alice");
  });

  it("leaves unmatched tokens untouched", () => {
    expect(formatMessage("Owner: {name}")).toBe("Owner: {name}");
  });
});

describe("pluralize", () => {
  it("picks the singular form for count 1 in English", () => {
    expect(pluralize("en", 1, { one: "{n} item", other: "{n} items" })).toBe("1 item");
  });

  it("picks the plural form for count other than 1 in English", () => {
    expect(pluralize("en", 3, { one: "{n} item", other: "{n} items" })).toBe("3 items");
    expect(pluralize("en", 0, { one: "{n} item", other: "{n} items" })).toBe("0 items");
  });

  it("picks a form for Hebrew without throwing, falling back to other for non-one categories", () => {
    expect(pluralize("he", 1, { one: "{n} פריט", other: "{n} פריטים" })).toBe("1 פריט");
    expect(pluralize("he", 5, { one: "{n} פריט", other: "{n} פריטים" })).toBe("5 פריטים");
  });
});

describe("formatDate / formatNumber", () => {
  const date = new Date("2026-03-15T00:00:00Z");

  it("produces different output for en vs he", () => {
    const enDate = formatDate(date, "en");
    const heDate = formatDate(date, "he");
    expect(enDate).not.toBe(heDate);
  });

  it("formats a number per locale", () => {
    const enNumber = formatNumber(1234.5, "en");
    const heNumber = formatNumber(1234.5, "he");
    expect(enNumber.length).toBeGreaterThan(0);
    expect(heNumber.length).toBeGreaterThan(0);
  });
});
