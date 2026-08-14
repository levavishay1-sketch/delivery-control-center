import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const KEY_LENGTH = 64;

/** Hashes a password with a random salt using scrypt. Stored as "salt:hash", both hex. */
export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scrypt(plain, salt, KEY_LENGTH)) as Buffer;
  return `${salt}:${derived.toString("hex")}`;
}

/** Verifies a plaintext password against a "salt:hash" string produced by hashPassword(). */
export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const [salt, hashHex] = stored.split(":");
  if (!salt || !hashHex) return false;
  const derived = (await scrypt(plain, salt, KEY_LENGTH)) as Buffer;
  const stored_ = Buffer.from(hashHex, "hex");
  if (derived.length !== stored_.length) return false;
  return timingSafeEqual(derived, stored_);
}
