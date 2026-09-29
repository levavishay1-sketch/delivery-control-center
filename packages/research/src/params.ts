import { readFileSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "./protocol.ts";

/**
 * Every open decision of the frozen protocol (section 12.1 and 12.2), by its
 * id. Nothing here has a default: a value is either UNSET or SET with who
 * decided it, when, and on what basis. Code that needs a value asks for it
 * through `requireParams`, which throws `BlockedError` naming the ids that
 * are missing — fail closed, never a convenient number.
 *
 * Where the protocol gives one row several parts that close at different
 * stages (U18, U23), the part is its own entry with `protocolId` pointing at
 * the row. Entries with an `OP-` id are operational parameters of the pilot
 * that the protocol does not define; they are listed separately so they are
 * never mistaken for protocol parameters.
 */

export const STAGES = ["before-pilot", "end-of-F1", "before-F4", "before-F6", "before-F8", "before-freeze-2", "before-deployment"] as const;
export type Stage = (typeof STAGES)[number];

export type Decider = "user" | "pilot" | "pilot+user";

export type ParamDef = {
  id: string;
  /** The protocol row this entry belongs to; absent for OP- entries. */
  protocolId?: string;
  title: string;
  stage: Stage;
  decider: Decider;
};

export const PARAMS: readonly ParamDef[] = [
  { id: "U1", title: "fc_max: maximum accepted false-certification rate", stage: "before-F8", decider: "user" },
  { id: "U2", title: "non-inferiority margin for task success (delta)", stage: "before-freeze-2", decider: "user" },
  { id: "U3", title: "non-inferiority margin for cost", stage: "before-freeze-2", decider: "user" },
  { id: "U4", title: "epsilon: success-effect threshold of the utility classifier", stage: "before-freeze-2", decider: "pilot+user" },
  { id: "U5", title: "kappa: cost-effect threshold of the utility classifier", stage: "before-freeze-2", decider: "pilot+user" },
  { id: "U6", title: "margin for growth of the always-loaded context", stage: "before-freeze-2", decider: "user" },
  { id: "U7", title: "classifier thresholds (KEEP precision, harm FP, DROP error, harmful share in NOT-PROVEN, UNCLASSIFIABLE)", stage: "before-freeze-2", decider: "user" },
  { id: "U8", title: "recall thresholds of risk identification and of the claims checker", stage: "before-freeze-2", decider: "user" },
  { id: "U9", title: "sigma_d, rho, cost variance, B dispersion, judge error", stage: "before-freeze-2", decider: "pilot" },
  { id: "U10", title: "N repos, m tasks per repo, r runs, r_sel selection runs, k_ref reference runs, k B generations", stage: "before-freeze-2", decider: "pilot" },
  { id: "U11", title: "whether /init runs non-interactively", stage: "end-of-F1", decider: "pilot" },
  { id: "U12", title: "exact Claude Code version and model id", stage: "before-pilot", decider: "user" },
  { id: "U13", title: "model training cutoff date", stage: "before-pilot", decider: "user" },
  { id: "U14", title: "memory-probe threshold and contamination-gap threshold", stage: "before-freeze-2", decider: "pilot+user" },
  { id: "U15", title: "size of the supported population per stratum", stage: "before-F8", decider: "pilot" },
  { id: "U16", title: "sampling-frame criteria", stage: "before-F8", decider: "user" },
  { id: "U17", title: "private organisation repositories for the holdout", stage: "before-pilot", decider: "user" },
  { id: "U18a", protocolId: "U18", title: "labelling capacity for judge calibration", stage: "before-F4", decider: "user" },
  { id: "U18b", protocolId: "U18", title: "human reviewer of the risk catalog", stage: "before-F4", decider: "user" },
  { id: "U18c", protocolId: "U18", title: "human audit capacity (section 7.8)", stage: "before-F8", decider: "user" },
  { id: "U19", title: "deterministic hook invocation; testability of network commands, MCP, subagents", stage: "before-freeze-2", decider: "pilot+user" },
  { id: "U20", title: "run limits of the locked experiment: turns, budget, timeout", stage: "before-freeze-2", decider: "pilot" },
  { id: "U21", title: "primary analysis method", stage: "before-freeze-2", decider: "pilot" },
  { id: "U22", title: "component sampling plan for ground truth", stage: "before-freeze-2", decider: "pilot+user" },
  { id: "U23-pilot", protocolId: "U23", title: "budget of the pilot", stage: "before-pilot", decider: "user" },
  { id: "U23-locked", protocolId: "U23", title: "budget of the locked experiment", stage: "before-F8", decider: "user" },
  { id: "U24", title: "whether the product requires at least one confirmatory V claim", stage: "before-F8", decider: "user" },
  { id: "U25", title: "practical-significance threshold for V claims", stage: "before-F6", decider: "user" },
  { id: "U26", title: "expiry thresholds", stage: "before-deployment", decider: "pilot+user" },
  { id: "U27", title: "maximum MDR-Repo for the 'no regression measured' statement", stage: "before-freeze-2", decider: "user" },
  { id: "U28", title: "B selection rule", stage: "before-freeze-2", decider: "pilot+user" },
  { id: "U29", title: "confirmatory or exploratory status of each V claim", stage: "before-freeze-2", decider: "pilot+user" },
  { id: "U30", title: "relevance-evidence extraction method and history window", stage: "before-freeze-2", decider: "pilot+user" },
  { id: "U31", title: "cost thresholds and risk classes of the justification rule", stage: "before-freeze-2", decider: "user" },
  { id: "U32", title: "minimum r for the tripwire", stage: "before-freeze-2", decider: "pilot" },
  { id: "U33", title: "threshold of runs stopped at the cap in arm A", stage: "before-freeze-2", decider: "pilot+user" },
  { id: "U34", title: "confidence-interval width required for C4", stage: "before-freeze-2", decider: "user" },
  { id: "U35", title: "maximum tripwire false-fire rate", stage: "before-freeze-2", decider: "user" },
  { id: "U36", title: "minimum repositories per component class for an NR or V claim", stage: "before-freeze-2", decider: "user" },
  { id: "U37", title: "number and source of pilot repositories", stage: "before-pilot", decider: "user" },
  { id: "U38", title: "confidence level, multiplicity correction and equivalence test for component classification", stage: "before-freeze-2", decider: "pilot+user" },
  { id: "U39", title: "rule for choosing F, maximum F-to-S_c distance, cutoff margin", stage: "before-freeze-2", decider: "pilot+user" },
  { id: "PP-1", title: "delivery while GPC is Experimental", stage: "before-deployment", decider: "user" },
  { id: "PP-2", title: "what to do with a NOT-PROVEN component", stage: "before-freeze-2", decider: "user" },
  { id: "PP-3", title: "ceiling on onboarding burden", stage: "before-deployment", decider: "user" },
  { id: "PP-4", title: "what counts as a damage flag", stage: "before-freeze-2", decider: "user" },
  { id: "PP-5", title: "which local behavioural evidence suffices to deliver knowledge components", stage: "before-deployment", decider: "user" },
  { id: "OP-1", title: "provisional per-run caps for pilot runs (turns, USD, timeout); not a protocol parameter, U20 is derived from runs made under it", stage: "before-pilot", decider: "user" },
];

export const protocolIdOf = (p: ParamDef): string | null => (p.id.startsWith("OP-") ? null : (p.protocolId ?? p.id));

export type ParamValue =
  | { state: "UNSET" }
  | { state: "SET"; value: unknown; decidedBy: string; decidedAt: string; basis: string };

export type ParamsFile = { entries: Record<string, ParamValue> };

export const PARAMS_FILE = "docs/research/pilot/params.json";

export class BlockedError extends Error {
  readonly missing: readonly string[];
  constructor(missing: readonly string[], why: string) {
    super(`BLOCKED by ${missing.join(", ")}: ${why}`);
    this.name = "BlockedError";
    this.missing = missing;
  }
}

/** A params file with every entry UNSET; the only state the file may start in. */
export function emptyParams(): ParamsFile {
  return { entries: Object.fromEntries(PARAMS.map((p) => [p.id, { state: "UNSET" } as ParamValue])) };
}

/** Validates the file against the registry: no unknown id, no missing id, a SET value carries who, when and why. */
export function validateParams(file: unknown): { ok: true; params: ParamsFile } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const entries = (file as ParamsFile | null)?.entries;
  if (!entries || typeof entries !== "object") return { ok: false, errors: ["missing 'entries'"] };
  const known = new Set(PARAMS.map((p) => p.id));
  for (const id of Object.keys(entries)) if (!known.has(id)) errors.push(`unknown parameter ${id}`);
  for (const p of PARAMS) {
    const v = entries[p.id];
    if (!v) { errors.push(`missing parameter ${p.id}`); continue; }
    if (v.state === "UNSET") continue;
    if (v.state !== "SET") { errors.push(`${p.id}: state must be UNSET or SET`); continue; }
    for (const k of ["decidedBy", "decidedAt", "basis"] as const) if (typeof v[k] !== "string" || !v[k].trim()) errors.push(`${p.id}: SET without ${k}`);
    if (v.value === undefined || v.value === null) errors.push(`${p.id}: SET without a value`);
  }
  return errors.length ? { ok: false, errors } : { ok: true, params: { entries } };
}

export function loadParams(root = REPO_ROOT): ParamsFile {
  const raw = JSON.parse(readFileSync(path.join(root, PARAMS_FILE), "utf8"));
  const v = validateParams(raw);
  if (!v.ok) throw new Error(`${PARAMS_FILE} is invalid:\n  ${v.errors.join("\n  ")}`);
  return v.params;
}

/** Returns the values of `ids`, or throws `BlockedError` naming every one that is UNSET. */
export function requireParams(params: ParamsFile, ids: readonly string[], why: string): Record<string, unknown> {
  const missing: string[] = [];
  const out: Record<string, unknown> = {};
  for (const id of ids) {
    const v = params.entries[id];
    if (!v) throw new Error(`requireParams: ${id} is not in the registry`);
    if (v.state === "SET") out[id] = v.value;
    else missing.push(id);
  }
  if (missing.length) throw new BlockedError(missing, why);
  return out;
}

/** The UNSET entries that must be closed by `stage`, in registry order. */
export function unsetBy(params: ParamsFile, stage: Stage): ParamDef[] {
  const limit = STAGES.indexOf(stage);
  return PARAMS.filter((p) => STAGES.indexOf(p.stage) <= limit && params.entries[p.id]?.state !== "SET");
}
