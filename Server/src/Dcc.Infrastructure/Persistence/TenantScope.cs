using Microsoft.EntityFrameworkCore;

namespace Dcc.Infrastructure.Persistence;

/// <summary>
/// The wall between clients (architecture decision 03). Runs <c>fn</c> inside a
/// transaction that:
/// <list type="number">
/// <item>drops to the <c>dcc_app</c> role (NOSUPERUSER NOBYPASSRLS), so RLS is
/// really enforced — the connecting role owns the tables and would bypass it;</item>
/// <item>sets <c>app.current_client</c>, so every policy resolves to this tenant.</item>
/// </list>
/// Both are transaction-local, so a pooled connection carries nothing over.
///
/// Re-entrant: a nested call on the same context for the same client reuses the open
/// transaction; for a different client it is a bug and throws. A call on ANOTHER context
/// (another DI scope — a background run recording to the ledger) opens its own transaction.
/// This is the only correct way to touch a tenant-scoped table.
/// </summary>
public interface ITenantScope
{
    Task<T> RunAsync<T>(Guid clientId, Func<DccDbContext, Task<T>> fn, CancellationToken ct = default);
}

public sealed class TenantScope(DccDbContext db) : ITenantScope
{
    private static readonly AsyncLocal<(DccDbContext Db, Guid Client)?> Current = new();

    public async Task<T> RunAsync<T>(Guid clientId, Func<DccDbContext, Task<T>> fn, CancellationToken ct = default)
    {
        if (Current.Value is { } open && ReferenceEquals(open.Db, db))
        {
            if (open.Client != clientId) throw new InvalidOperationException($"nested tenant scope for a different client ({open.Client} → {clientId})");
            return await fn(db);
        }

        await using var tx = await db.Database.BeginTransactionAsync(ct);
        await db.Database.ExecuteSqlRawAsync("set local role dcc_app", ct);
        await db.Database.ExecuteSqlAsync($"select set_config('app.current_client', {clientId.ToString()}, true)", ct);
        var outer = Current.Value;
        Current.Value = (db, clientId);
        try
        {
            var result = await fn(db);
            await tx.CommitAsync(ct);
            return result;
        }
        finally
        {
            Current.Value = outer;
        }
    }
}
