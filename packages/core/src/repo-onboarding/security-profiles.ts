import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Repository AI Enablement — security profile catalog (spec §11 Stage
 * 04). Same cached-flat-JSON-file pattern as `routing.ts`'s
 * `loadPolicy()` (`config/model-policy.json`) — a small, DCC-owned,
 * reviewed catalog, not a DB table with an admin UI nothing in the spec
 * asked for. `resolveEffectivePolicy` implements the spec's own
 * "Organization Policy + Repository-specific Delta = Effective Policy":
 * the chosen catalog profile is the organization layer, the repo's own
 * approved path-deny-rules (from `security_permissions`'s existing
 * suggestion/approval flow) are the repository-specific delta.
 */

export type PermissionVerb = "allow" | "ask" | "deny";
export type SecurityProfile = {
  label: string;
  description: string;
  read: PermissionVerb;
  write: PermissionVerb;
  commands: { build: PermissionVerb; test: PermissionVerb; lint: PermissionVerb; git_read: PermissionVerb; git_push: PermissionVerb; deployment: PermissionVerb; destructive: PermissionVerb };
  network: PermissionVerb;
  mcp: PermissionVerb;
};
type Catalog = { version: number; profiles: Record<string, SecurityProfile> };

const CATALOG_PATH = fileURLToPath(new URL("../../../../config/security-profiles.json", import.meta.url));
let cached: Catalog | null = null;

export function loadProfileCatalog(): Catalog {
  if (!cached) cached = JSON.parse(readFileSync(CATALOG_PATH, "utf8")) as Catalog;
  return cached;
}

export function getSecurityProfile(profileId: string): SecurityProfile | null {
  return loadProfileCatalog().profiles[profileId] ?? null;
}

export type EffectivePolicy = {
  profileId: string;
  profile: SecurityProfile;
  /** The repository-specific delta layered on top of the org profile —
   *  today just the approved path-deny-rules from `security_permissions`'
   *  existing suggestion/approval flow (spec §11's "restricted reads"). */
  deniedReadPaths: string[];
};

export function resolveEffectivePolicy(profileId: string, deniedReadPaths: string[]): EffectivePolicy {
  const profile = getSecurityProfile(profileId);
  if (!profile) throw new Error(`unknown security profile "${profileId}"`);
  return { profileId, profile, deniedReadPaths };
}

/** Deterministic profile suggestion off `classification`'s own signals —
 *  a starting point for human review/approval, never applied unapproved.
 *  Simple, explainable rules only (spec §11: "Claude must not invent the
 *  organization's security policy" — this heuristic picks among DCC's
 *  own pre-reviewed profiles, it never invents a new one). */
export function suggestSecurityProfile(classification: { repository_type?: string; detected_domains?: string[]; complexity?: string; legacy_indicator?: boolean } | undefined): string {
  const domains = (classification?.detected_domains ?? []).map((d) => d.toLowerCase()).join(" ");
  const repoType = (classification?.repository_type ?? "").toLowerCase();
  const SENSITIVE = /compliance|kyc|aml|blacklist|payment|financ|regulat|pii|privacy/;
  if (SENSITIVE.test(domains)) return "RESTRICTED";
  if (/infrastructure|deploy|devops|terraform|pipeline/.test(repoType) || /infrastructure|deploy|devops/.test(domains)) return "INFRASTRUCTURE";
  if (/demo|sample|sandbox|experiment/.test(repoType)) return "SANDBOX";
  return "STANDARD_DEVELOPMENT";
}
