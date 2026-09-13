export declare const ADO_API_VERSIONS: string[];
export declare function adoAuthHeader(pat: string): Record<string, string>;
type GetResult = {
    ok: true;
    apiVersion: string;
    body: unknown;
} | {
    ok: false;
    status: number;
    detail: string;
    resourceMissing?: boolean;
};
/** GET an ADO REST path, walking api-versions until one isn't a 404. */
export declare function adoGet(base: string, path: string, pat: string): Promise<GetResult>;
type SendResult = {
    ok: true;
    apiVersion: string;
    body: Record<string, unknown>;
} | {
    ok: false;
    status: number;
    detail: string;
};
/**
 * POST/PATCH a full ADO REST URL suffix (everything after `/_apis/`).
 * `contentType` is usually "application/json-patch+json" for work items.
 * Walks api-versions like adoGet.
 */
/** DELETE an ADO REST path (soft-delete for work items → recycle bin). */
export declare function adoDelete(base: string, apiPath: string, pat: string): Promise<{
    ok: boolean;
    status: number;
    detail?: string;
}>;
/** Upload raw bytes as an ADO attachment → { id, url }. */
export declare function adoUpload(input: {
    base: string;
    fileName: string;
    bytes: Buffer | Uint8Array;
    pat: string;
}): Promise<{
    ok: true;
    id: string;
    url: string;
} | {
    ok: false;
    status: number;
    detail: string;
}>;
export declare function adoSend(input: {
    base: string;
    apiPath: string;
    method: "POST" | "PATCH";
    body: unknown;
    pat: string;
    contentType?: string;
}): Promise<SendResult>;
export {};
//# sourceMappingURL=ado-http.d.ts.map