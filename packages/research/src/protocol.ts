import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The frozen Research Protocol v1 is the source of truth for everything in
 * this package. Nothing here restates a rule from it; code refers to the
 * protocol by section and parameter id, and every evidence record carries
 * the hash of the protocol text it was produced under.
 *
 * The hash is taken over the text with CRLF normalised to LF: that is the
 * content git stores (core.autocrlf=true on this machine) and the content
 * the Freeze 1 record hashed, whatever a checkout wrote to disk.
 */

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

export const FROZEN_PROTOCOL = {
  file: "docs/research/onboarding-research-protocol-v1.md",
  sha256: "cba004014cbaa55c79222bb3d097a1f6c933de656ab175a107b0ab02c892c0a3",
  freezeRecord: "docs/research/onboarding-research-protocol-v1.freeze-1.md",
  tag: "research-protocol-v1-freeze-1",
  textCommit: "e379d22332fcd93c501608ac1da3831002ec8a41",
} as const;

export const sha256 = (data: string | Buffer): string => createHash("sha256").update(data).digest("hex");

/** SHA-256 of a text with CRLF normalised to LF. */
export const textSha256 = (text: string): string => sha256(text.replace(/\r\n/g, "\n"));

export type ProtocolCheck =
  | { ok: true; sha256: string }
  | { ok: false; sha256: string; reason: string };

/**
 * Whether the protocol on disk is the frozen text. A mismatch is not an
 * error to work around: after Freeze 1 any change is a numbered amendment,
 * and the pilot must not run under a text nobody froze.
 */
export function checkProtocol(root = REPO_ROOT): ProtocolCheck {
  let text: string;
  try {
    text = readFileSync(path.join(root, FROZEN_PROTOCOL.file), "utf8");
  } catch (e) {
    return { ok: false, sha256: "", reason: `cannot read ${FROZEN_PROTOCOL.file}: ${(e as Error).message}` };
  }
  const h = textSha256(text);
  return h === FROZEN_PROTOCOL.sha256
    ? { ok: true, sha256: h }
    : { ok: false, sha256: h, reason: `protocol text differs from Freeze 1 (${FROZEN_PROTOCOL.sha256}); an amendment must be recorded before the pilot runs under it` };
}
