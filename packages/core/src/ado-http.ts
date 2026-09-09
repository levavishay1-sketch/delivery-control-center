/**
 * Low-level Azure DevOps REST helpers, shared by the connect flow and
 * the write-sync. Pure-ish (only `fetch`), no db imports.
 *
 * On-prem Server ships older API surfaces; cloud is always current.
 * Server 2022→7.x, 2020→6.0, 2019→5.0, TFS 2018→4.1. Newest first; an
 * old server 404s versions it doesn't know, so we walk down.
 */
export const ADO_API_VERSIONS = ["7.1", "7.0", "6.0", "5.1", "5.0", "4.1"];

export function adoAuthHeader(pat: string): Record<string, string> {
  return { authorization: `Basic ${Buffer.from(`:${pat}`).toString("base64")}`, accept: "application/json" };
}

type GetResult =
  | { ok: true; apiVersion: string; body: unknown }
  | { ok: false; status: number; detail: string };

/** GET an ADO REST path, walking api-versions until one isn't a 404. */
export async function adoGet(base: string, path: string, pat: string): Promise<GetResult> {
  const clean = base.replace(/\/+$/, "");
  let last: { status: number; statusText: string } | { network: string } | null = null;
  for (const v of ADO_API_VERSIONS) {
    try {
      const res = await fetch(`${clean}/_apis/${path}${path.includes("?") ? "&" : "?"}api-version=${v}`, {
        headers: adoAuthHeader(pat),
      });
      if (res.ok) return { ok: true, apiVersion: v, body: await res.json().catch(() => null) };
      if (res.status === 401) return { ok: false, status: 401, detail: "401 — ה-PAT נדחה. בדוק שהוא בתוקף ושיש לו Work Items + Code (Read)." };
      last = { status: res.status, statusText: res.statusText };
    } catch (e) {
      last = { network: String((e as Error).message) };
      break;
    }
  }
  if (last && "network" in last) return { ok: false, status: 0, detail: `שגיאת רשת: ${last.network} — האם ${clean} נגיש מהשרת?` };
  return { ok: false, status: last?.status ?? 0, detail: last ? `${last.status} ${last.statusText}` : "no response" };
}

type SendResult =
  | { ok: true; apiVersion: string; body: Record<string, unknown> }
  | { ok: false; status: number; detail: string };

/**
 * POST/PATCH a full ADO REST URL suffix (everything after `/_apis/`).
 * `contentType` is usually "application/json-patch+json" for work items.
 * Walks api-versions like adoGet.
 */
/** DELETE an ADO REST path (soft-delete for work items → recycle bin). */
export async function adoDelete(base: string, apiPath: string, pat: string): Promise<{ ok: boolean; status: number; detail?: string }> {
  const clean = base.replace(/\/+$/, "");
  let sawOnly404 = true;
  let last = 0;
  for (const v of ADO_API_VERSIONS) {
    try {
      const sep = apiPath.includes("?") ? "&" : "?";
      const res = await fetch(`${clean}/_apis/${apiPath}${sep}api-version=${v}`, { method: "DELETE", headers: adoAuthHeader(pat) });
      if (res.ok) return { ok: true, status: res.status };
      if (res.status === 401) return { ok: false, status: 401, detail: "PAT rejected" };
      if (res.status !== 404) sawOnly404 = false;
      last = res.status;
    } catch (e) {
      return { ok: false, status: 0, detail: String((e as Error).message) };
    }
  }
  // every version 404'd → the work item (or the whole api) isn't there; for a
  // delete that's the desired end state.
  return sawOnly404 ? { ok: true, status: 404 } : { ok: false, status: last };
}

export async function adoSend(input: {
  base: string;
  apiPath: string; // e.g. "wit/workitems/$Task" or "wit/workitems/42"
  method: "POST" | "PATCH";
  body: unknown;
  pat: string;
  contentType?: string;
}): Promise<SendResult> {
  const clean = input.base.replace(/\/+$/, "");
  const ct = input.contentType ?? "application/json-patch+json";
  let last: { status: number; text: string } | { network: string } | null = null;
  for (const v of ADO_API_VERSIONS) {
    try {
      const sep = input.apiPath.includes("?") ? "&" : "?";
      const res = await fetch(`${clean}/_apis/${input.apiPath}${sep}api-version=${v}`, {
        method: input.method,
        headers: { ...adoAuthHeader(input.pat), "content-type": ct },
        body: JSON.stringify(input.body),
      });
      if (res.ok) return { ok: true, apiVersion: v, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
      const text = await res.text().catch(() => "");
      if (res.status === 401) return { ok: false, status: 401, detail: "401 — ה-PAT נדחה (צריך Work Items: Read, write & manage)." };
      // a bad api-version 404s or returns a preview-version error; keep walking
      last = { status: res.status, text: text.slice(0, 300) };
    } catch (e) {
      last = { network: String((e as Error).message) };
      break;
    }
  }
  if (last && "network" in last) return { ok: false, status: 0, detail: `שגיאת רשת: ${last.network}` };
  return { ok: false, status: last?.status ?? 0, detail: last ? `${last.status} — ${last.text}` : "no response" };
}
