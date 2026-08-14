import { describe, expect, it, beforeAll } from "vitest";
import { encryptSecret, decryptSecret } from "./crypto";

beforeAll(() => {
  // A fixed 32-byte test key so this suite doesn't depend on the real .env value.
  process.env.ENCRYPTION_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
});

describe("encryptSecret / decryptSecret", () => {
  it("round-trips a plaintext value", () => {
    const plain = "sk-super-secret-api-token";
    const cipher = encryptSecret(plain);
    expect(cipher).not.toBe(plain);
    expect(decryptSecret(cipher)).toBe(plain);
  });

  it("produces different ciphertext for the same plaintext on each call (random IV)", () => {
    const a = encryptSecret("same-value");
    const b = encryptSecret("same-value");
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe("same-value");
    expect(decryptSecret(b)).toBe("same-value");
  });

  it("throws when the ciphertext has been tampered with", () => {
    const cipher = encryptSecret("tamper-me");
    const [iv, tag] = cipher.split(":");
    const tampered = [iv, tag, Buffer.from("garbage").toString("base64")].join(":");
    expect(() => decryptSecret(tampered)).toThrow();
  });
});
