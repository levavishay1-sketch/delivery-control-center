using System.Text.Json;
using Dcc.Domain.Audit;
using Dcc.Infrastructure.Persistence;
using Microsoft.Extensions.DependencyInjection;

namespace Dcc.Infrastructure.Audit;

/// <summary>The audit record kept in Postgres (<c>audit_log</c>, append-only by trigger).</summary>
public sealed class PostgresAuditLog(DccDbContext db) : IAuditLog
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public async Task WriteAsync(AuditEntry entry, CancellationToken ct = default)
    {
        db.AuditLog.Add(new AuditLogRow
        {
            At = DateTimeOffset.UtcNow,
            ActorUserId = entry.ActorUserId,
            Action = entry.Action,
            TargetType = entry.TargetType,
            TargetId = entry.TargetId,
            Before = entry.Before is null ? null : JsonSerializer.Serialize(entry.Before, Json),
            After = entry.After is null ? null : JsonSerializer.Serialize(entry.After, Json),
            Ip = entry.Ip,
        });
        await db.SaveChangesAsync(ct);
    }
}

public static class AuditLogRegistration
{
    /// <summary>The one place that decides where the audit record is kept.</summary>
    public static IServiceCollection AddAuditLog(this IServiceCollection services) =>
        services.AddScoped<IAuditLog, PostgresAuditLog>();
}
