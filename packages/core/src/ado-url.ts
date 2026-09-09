/**
 * Azure DevOps URL handling — pure, no db imports, unit-testable.
 *
 * Users paste all sorts of things into the "Organization URL" box: the
 * clean org/collection base, or the full browser URL that also carries
 * the project (and sometimes a repo path after that). We want to end up
 * with a clean { orgUrl, project }.
 *
 *   cloud    https://dev.azure.com/my-org                    → my-org
 *   cloud    https://dev.azure.com/my-org/My Project         → my-org, "My Project"
 *   cloud    https://dev.azure.com/my-org/My Project/_git/x  → my-org, "My Project"
 *   on-prem  http://host/DefaultCollection                   → collection
 *   on-prem  http://host/DefaultCollection/My Project        → collection, "My Project"
 *   on-prem  http://host/tfs/DefaultCollection/My%20Project  → collection (tfs vdir kept)
 */
export function splitAdoUrl(rawOrgUrl: string): { orgUrl: string; projectFromUrl: string } {
  const raw = rawOrgUrl.trim().replace(/\/+$/, "");
  try {
    const u = new URL(raw);
    let segs = u.pathname.split("/").filter(Boolean).map((s) => decodeURIComponent(s));

    // drop anything from a known sub-resource marker onward (_git, _apis, …)
    const marker = segs.findIndex((s) => s.startsWith("_"));
    if (marker >= 0) segs = segs.slice(0, marker);

    const isCloud = /(^|\.)dev\.azure\.com$/i.test(u.hostname) || /\.visualstudio\.com$/i.test(u.hostname);

    // how many leading segments form the org/collection base
    let baseLen: number;
    if (isCloud) {
      baseLen = 1; // the org
    } else {
      baseLen = segs[0]?.toLowerCase() === "tfs" ? 2 : 1; // optional /tfs/ vdir + collection
    }

    const baseSegs = segs.slice(0, baseLen);
    const rest = segs.slice(baseLen);
    const projectFromUrl = rest[0] ?? "";
    const orgUrl = `${u.origin}${baseSegs.length ? "/" + baseSegs.join("/") : ""}`;
    return { orgUrl, projectFromUrl };
  } catch {
    return { orgUrl: raw, projectFromUrl: "" };
  }
}

/**
 * Reconcile a pasted URL with a separately-typed project field.
 * A project in the URL path wins (it's copied from a real ADO page);
 * otherwise use the typed field.
 */
export function normaliseAdoUrl(rawOrgUrl: string, rawProject: string): { orgUrl: string; project: string } {
  const { orgUrl, projectFromUrl } = splitAdoUrl(rawOrgUrl);
  const project = (projectFromUrl || rawProject).trim();
  return { orgUrl, project };
}
