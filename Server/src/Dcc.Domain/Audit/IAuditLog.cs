namespace Dcc.Domain.Audit;

/// <summary>
/// The org-level record of every change to identity and permissions — who
/// changed what, from what, to what ("no silent actions"). Append-only in the
/// database. Like the event log, callers depend on this interface only, so
/// where the record is kept is chosen in one place (<c>AddAuditLog()</c>).
/// </summary>
public interface IAuditLog
{
    Task WriteAsync(AuditEntry entry, CancellationToken ct = default);
}

/// <param name="Action">e.g. <c>user.created</c>, <c>role_assignment.granted</c>, <c>auth.login_failed</c>.</param>
/// <param name="Before">The state before (null for a creation); serialized as JSON.</param>
/// <param name="After">The state after (null for a deletion); serialized as JSON.</param>
public sealed record AuditEntry(
    Guid? ActorUserId,
    string Action,
    string TargetType,
    string? TargetId,
    object? Before = null,
    object? After = null,
    string? Ip = null);
