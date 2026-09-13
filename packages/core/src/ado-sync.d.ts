/**
 * Push a DCC requirement into Azure DevOps as a work item and link it
 * back (linkedAdoId + a `ado.synced` event carrying the URL). Once
 * linked, ADO is the source of truth for the work item's state
 * (architecture §8) — later edits PATCH it.
 *
 * Not yet: pulling state changes back from ADO, iteration paths,
 * rich field mapping. This is the create + parent-link slice.
 */
export type AdoConn = {
    id: string;
    secretRef: string;
    config: Record<string, string>;
};
export declare function activeAdoConnection(clientId: string): Promise<AdoConn | null>;
/** The human-facing URL for a work item on this server. */
export declare function adoWorkItemUrl(orgUrl: string, project: string, adoId: number): string;
export declare function syncRequirementToAdo(input: {
    clientId: string;
    workitemId: string;
    by: {
        userId: string;
    };
}): Promise<{
    adoId: number;
    url: string;
    created: boolean;
}>;
/**
 * Soft-delete the linked ADO work item (→ recycle bin). Best-effort:
 * returns a status string, never throws — a DCC delete shouldn't be
 * blocked by ADO being unreachable.
 */
export declare function deleteAdoForRequirement(clientId: string, linkedAdoId: number): Promise<{
    ok: boolean;
    detail: string;
}>;
/**
 * Push every not-yet-linked requirement of a client into the connected
 * ADO project (create). Used after a CSV import. Returns per-item outcome.
 */
export declare function syncAllToAdo(clientId: string, by: {
    userId: string;
}): Promise<{
    total: number;
    created: number;
    failed: number;
    items: {
        title: string;
        ok: boolean;
        adoId?: number;
        url?: string;
        error?: string;
    }[];
}>;
/** Best-effort sync used right after creating a requirement. Never throws. */
export declare function trySyncNewRequirement(clientId: string, workitemId: string, by: {
    userId: string;
}): Promise<{
    synced: false;
    error?: undefined;
} | {
    adoId: number;
    url: string;
    created: boolean;
    synced: true;
    error?: undefined;
} | {
    synced: false;
    error: string;
}>;
//# sourceMappingURL=ado-sync.d.ts.map