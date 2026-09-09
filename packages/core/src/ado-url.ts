/**
 * Normalise whatever the user pasted as the "Organization URL" into a
 * clean collection/org base, splitting off the project if they pasted
 * the whole browser URL.
 *
 * Accepts, and maps to { orgUrl, project }:
 *   cloud    https://dev.azure.com/my-org                 → my-org
 *   cloud    https://dev.azure.com/my-org/My Project      → my-org, "My Project"
 *   on-prem  http://server/DefaultCollection              → collection
 *   on-prem  http://server/DefaultCollection/My Project   → collection, "My Project"
 *   on-prem  http://server/tfs/DefaultCollection/My%20Proj (decoded)
 *
 * No db imports here on purpose — pure and unit-testable.
 */
export function normaliseAdoUrl(rawOrgUrl: string, rawProject: string): { orgUrl: string; project: string } {
  let url = rawOrgUrl.trim().replace(/\/+$/, "");
  let project = rawProject.trim();
  try {
    const u = new URL(url);
    const segs = u.pathname.split("/").filter(Boolean).map((s) => decodeURIComponent(s));
    if (project && segs.length > 0 && segs[segs.length - 1]!.toLowerCase() === project.toLowerCase()) {
      // user pasted "<base>/<project>" AND filled the project field
      segs.pop();
    } else if (!project && segs.length >= 2) {
      // "<base>/<project>" with an empty project field — take the last segment
      // (cloud keeps the org as segment 0; on-prem keeps host+collection).
      project = segs.pop()!;
    }
    url = `${u.origin}/${segs.join("/")}`.replace(/\/+$/, "");
  } catch {
    /* not a parseable URL — leave as typed */
  }
  return { orgUrl: url, project };
}
