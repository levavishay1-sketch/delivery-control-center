import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { sha256 } from "./protocol.ts";

/**
 * The evidence record of the pilot: one append-only JSON-lines file per
 * campaign directory. Each record carries the hash of the protocol text and
 * of the parameter snapshot it ran under, the hashes of its inputs and
 * outputs, and `prev`, the hash of the line before it, so that an edited,
 * removed or reordered line breaks the chain and `verifyChain` finds it.
 *
 * Raw outputs (transcripts, copies, test logs) live next to the log in the
 * campaign directory, outside the repository; only summaries are committed.
 */

export type RecordStatus = "OK" | "FAILED" | "INVALID" | "BLOCKED" | "INCOMPLETE";

export type EvidenceInput = {
  kind: string;
  question: string;
  status: RecordStatus;
  protocolSha256: string;
  paramsSha256: string;
  startedAt: string;
  finishedAt: string;
  blockedBy?: readonly string[];
  inputs?: readonly { name: string; sha256: string }[];
  outputs?: readonly { path: string; sha256: string }[];
  environment?: Record<string, string>;
  data?: Record<string, unknown>;
  notes?: string;
};

export type EvidenceRecord = EvidenceInput & { seq: number; prev: string; hash: string };

export const GENESIS = "GENESIS";

/** The campaign root: `DCC_PILOT_DIR`, or `~/.dcc-pilot`. */
export const pilotRoot = (): string => process.env.DCC_PILOT_DIR ?? path.join(homedir(), ".dcc-pilot");

/** JSON with object keys sorted at every depth, so the same record always hashes the same. */
export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj).sort().filter((k) => obj[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`).join(",")}}`;
}

const LOG = "evidence.jsonl";

function lines(file: string): string[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\n").filter((l) => l.length > 0);
}

/** Appends one record to the campaign's log and returns it with its chain fields. */
export function appendEvidence(campaignDir: string, input: EvidenceInput): EvidenceRecord {
  mkdirSync(campaignDir, { recursive: true });
  const file = path.join(campaignDir, LOG);
  const existing = lines(file);
  const last = existing.at(-1);
  const prev = last === undefined ? GENESIS : sha256(last);
  const body = { ...input, seq: existing.length, prev };
  const record: EvidenceRecord = { ...body, hash: sha256(canonical(body)) };
  appendFileSync(file, `${canonical(record)}\n`, { flag: "a" });
  return record;
}

export type ChainCheck = { ok: true; records: number } | { ok: false; records: number; line: number; reason: string };

/** Re-derives every record's hash and link; the first break is reported by its 1-based line. */
export function verifyChain(campaignDir: string): ChainCheck {
  const all = lines(path.join(campaignDir, LOG));
  let prev = GENESIS;
  for (let i = 0; i < all.length; i++) {
    let rec: EvidenceRecord;
    try { rec = JSON.parse(all[i]!) as EvidenceRecord; } catch { return { ok: false, records: all.length, line: i + 1, reason: "not JSON" }; }
    const { hash, ...body } = rec;
    if (rec.seq !== i) return { ok: false, records: all.length, line: i + 1, reason: `seq ${rec.seq}, expected ${i}` };
    if (rec.prev !== prev) return { ok: false, records: all.length, line: i + 1, reason: "link to the previous line is broken" };
    if (sha256(canonical(body)) !== hash) return { ok: false, records: all.length, line: i + 1, reason: "record content does not match its hash" };
    prev = sha256(all[i]!);
  }
  return { ok: true, records: all.length };
}

export function readEvidence(campaignDir: string): EvidenceRecord[] {
  return lines(path.join(campaignDir, LOG)).map((l) => JSON.parse(l) as EvidenceRecord);
}
