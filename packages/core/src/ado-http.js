/**
 * Low-level Azure DevOps REST helpers, shared by the connect flow and
 * the write-sync. Pure-ish (only `fetch`), no db imports.
 *
 * On-prem Server ships older API surfaces; cloud is always current.
 * Server 2022→7.x, 2020→6.0, 2019→5.0, TFS 2018→4.1. Newest first; an
 * old server 404s versions it doesn't know, so we walk down.
 */
const ALL_VERSIONS = ["7.1", "7.0", "6.0", "5.1", "5.0", "4.1"];
/** Every ADO call below is user-triggered (approve, materialize, pull)
 *  and must never hang a request indefinitely — a misconfigured host or
 *  an unreachable network previously hung `fetch` with no OS-level
 *  timeout, blocking the caller (e.g. approving a task) forever. */
const ADO_TIMEOUT_MS = 20_000;
/**
 * Per-host cache of the api-version that worked. Old on-prem servers
 * 404 the versions they don't know, so without this every call walks
 * ~5 dead versions — turning one request into six.
 */
const workingVersion = new Map();
function versionsFor(base) {
    const host = base.replace(/^https?:\/\//, "").split("/")[0] ?? base;
    const cached = workingVersion.get(host);
    return cached ? [cached, ...ALL_VERSIONS.filter((v) => v !== cached)] : ALL_VERSIONS;
}
function rememberVersion(base, v) {
    const host = base.replace(/^https?:\/\//, "").split("/")[0] ?? base;
    workingVersion.set(host, v);
}
export const ADO_API_VERSIONS = ALL_VERSIONS;
export function adoAuthHeader(pat) {
    return { authorization: `Basic ${Buffer.from(`:${pat}`).toString("base64")}`, accept: "application/json" };
}
/** GET an ADO REST path, walking api-versions until one isn't a 404. */
export async function adoGet(base, path, pat) {
    const clean = base.replace(/\/+$/, "");
    let last = null;
    let resourceMissing = false;
    for (const v of versionsFor(clean)) {
        try {
            const res = await fetch(`${clean}/_apis/${path}${path.includes("?") ? "&" : "?"}api-version=${v}`, {
                headers: adoAuthHeader(pat), signal: AbortSignal.timeout(ADO_TIMEOUT_MS),
            });
            if (res.ok) {
                rememberVersion(clean, v);
                return { ok: true, apiVersion: v, body: await res.json().catch(() => null) };
            }
            if (res.status === 401)
                return { ok: false, status: 401, detail: "401 — ה-PAT נדחה. בדוק שהוא בתוקף ושיש לו Work Items + Code (Read)." };
            // A genuine "not found" from ADO carries a JSON body with a message
            // like "TF401232: Work item N does not exist". A version-probe miss
            // is an HTML/plain "Page not found" with no such shape.
            if (res.status === 404) {
                const ct = res.headers.get("content-type") ?? "";
                if (ct.includes("json")) {
                    const b = (await res.json().catch(() => null));
                    if (b && typeof b.message === "string" && /does not exist|TF401232|was not found|deleted/i.test(b.message)) {
                        return { ok: false, status: 404, detail: b.message.slice(0, 200), resourceMissing: true };
                    }
                }
            }
            last = { status: res.status, statusText: res.statusText };
        }
        catch (e) {
            last = { network: String(e.message) };
            break;
        }
    }
    if (last && "network" in last)
        return { ok: false, status: 0, detail: `שגיאת רשת: ${last.network} — האם ${clean} נגיש מהשרת?` };
    return { ok: false, status: last?.status ?? 0, detail: last ? `${last.status} ${last.statusText}` : "no response", resourceMissing };
}
/**
 * POST/PATCH a full ADO REST URL suffix (everything after `/_apis/`).
 * `contentType` is usually "application/json-patch+json" for work items.
 * Walks api-versions like adoGet.
 */
/** DELETE an ADO REST path (soft-delete for work items → recycle bin). */
export async function adoDelete(base, apiPath, pat) {
    const clean = base.replace(/\/+$/, "");
    let sawOnly404 = true;
    let last = 0;
    for (const v of versionsFor(clean)) {
        try {
            const sep = apiPath.includes("?") ? "&" : "?";
            const res = await fetch(`${clean}/_apis/${apiPath}${sep}api-version=${v}`, { method: "DELETE", headers: adoAuthHeader(pat), signal: AbortSignal.timeout(ADO_TIMEOUT_MS) });
            if (res.ok) {
                rememberVersion(clean, v);
                return { ok: true, status: res.status };
            }
            if (res.status === 401)
                return { ok: false, status: 401, detail: "PAT rejected" };
            if (res.status !== 404)
                sawOnly404 = false;
            last = res.status;
        }
        catch (e) {
            return { ok: false, status: 0, detail: String(e.message) };
        }
    }
    // every version 404'd → the work item (or the whole api) isn't there; for a
    // delete that's the desired end state.
    return sawOnly404 ? { ok: true, status: 404 } : { ok: false, status: last };
}
/** Upload raw bytes as an ADO attachment → { id, url }. */
export async function adoUpload(input) {
    const clean = input.base.replace(/\/+$/, "");
    let last = null;
    for (const v of versionsFor(clean)) {
        try {
            const res = await fetch(`${clean}/_apis/wit/attachments?fileName=${encodeURIComponent(input.fileName)}&api-version=${v}`, {
                method: "POST",
                headers: { ...adoAuthHeader(input.pat), "content-type": "application/octet-stream" },
                body: input.bytes,
                signal: AbortSignal.timeout(ADO_TIMEOUT_MS),
            });
            if (res.ok) {
                rememberVersion(clean, v);
                const b = (await res.json().catch(() => ({})));
                return { ok: true, id: b.id ?? "", url: b.url ?? "" };
            }
            if (res.status === 401)
                return { ok: false, status: 401, detail: "401 — PAT rejected (needs Work Items: write)" };
            last = { status: res.status, text: (await res.text().catch(() => "")).slice(0, 200) };
        }
        catch (e) {
            return { ok: false, status: 0, detail: String(e.message) };
        }
    }
    return { ok: false, status: last && "status" in last ? last.status : 0, detail: last && "text" in last ? last.text : "no response" };
}
export async function adoSend(input) {
    const clean = input.base.replace(/\/+$/, "");
    const ct = input.contentType ?? "application/json-patch+json";
    let last = null;
    for (const v of versionsFor(clean)) {
        try {
            const sep = input.apiPath.includes("?") ? "&" : "?";
            const res = await fetch(`${clean}/_apis/${input.apiPath}${sep}api-version=${v}`, {
                method: input.method,
                headers: { ...adoAuthHeader(input.pat), "content-type": ct },
                body: JSON.stringify(input.body),
                signal: AbortSignal.timeout(ADO_TIMEOUT_MS),
            });
            if (res.ok) {
                rememberVersion(clean, v);
                return { ok: true, apiVersion: v, body: (await res.json().catch(() => ({}))) };
            }
            const text = await res.text().catch(() => "");
            if (res.status === 401)
                return { ok: false, status: 401, detail: "401 — ה-PAT נדחה (צריך Work Items: Read, write & manage)." };
            // a bad api-version 404s or returns a preview-version error; keep walking
            last = { status: res.status, text: text.slice(0, 300) };
        }
        catch (e) {
            last = { network: String(e.message) };
            break;
        }
    }
    if (last && "network" in last)
        return { ok: false, status: 0, detail: `שגיאת רשת: ${last.network}` };
    return { ok: false, status: last?.status ?? 0, detail: last ? `${last.status} — ${last.text}` : "no response" };
}
//# sourceMappingURL=ado-http.js.map