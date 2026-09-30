using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using Dcc.Application.Common;
using Dcc.Domain.Events;
using Dcc.Infrastructure.Ado;
using Dcc.Infrastructure.Persistence;

namespace Dcc.Infrastructure.Requirements;

/// <summary>
/// Files on a requirement. DCC stores the bytes and reads the text out of them —
/// that text is what assess and breakdown send to Claude, so a file that was
/// attached is a file that was read. Azure DevOps is the mirror, not the store:
/// with a connection the file is also uploaded there (and linked to the TFS item),
/// and a client without one — or a connection having a bad day — still attaches.
/// </summary>
public sealed class AttachmentService(ITenantScope tenant, IEventLogWriter events, BriefService brief, AdoClient ado)
{
    public const int MaxBytes = 25 * 1024 * 1024;

    public async Task<JsonObject> AddAsync(Guid clientId, Guid workitemId, string name, byte[] bytes, Guid actor, CancellationToken ct)
    {
        if (bytes.Length == 0) throw AppException.Conflict("attachment_refused", "הקובץ ריק");
        if (bytes.Length > MaxBytes)
            throw AppException.Conflict("attachment_refused", $"הקובץ גדול מ-{MaxBytes / 1024 / 1024}MB. צרפו קובץ קטן יותר, או הדביקו את התוכן כהערה.");

        var (linkedAdoId, conn) = await tenant.RunAsync(clientId, async d =>
        {
            var wi = await SqlJson.QuerySingleAsync(d, "select linked_ado_id as \"ado\" from workitem where id = @w", new { w = workitemId }, ct)
                     ?? throw AppException.NotFound("requirement");
            var c = await SqlJson.QuerySingleAsync(d, """
                select secret_ref as "pat", config from service_connection
                where client_id = @c and kind = 'ado' and revoked_at is null order by created_at desc limit 1
                """, new { c = clientId }, ct);
            return (wi["ado"]?.GetValue<int>(), c);
        }, ct);

        var (text, reason) = DocumentReader.ExtractText(name, bytes);

        string? adoUrl = null, adoAttId = null;
        if (conn is not null)
        {
            var orgUrl = (conn["config"]?["orgUrl"]?.GetValue<string>() ?? "").TrimEnd('/');
            var project = conn["config"]?["project"]?.GetValue<string>() ?? "";
            var projBase = project.Length > 0 ? $"{orgUrl}/{Uri.EscapeDataString(project)}" : orgUrl;
            var pat = conn["pat"]!.GetValue<string>();
            var up = await ado.UploadAsync(projBase, name, bytes, pat, ct);
            if (up.Ok && up.Body is { } b)
            {
                adoUrl = b.TryGetProperty("url", out var u) ? u.GetString() : null;
                adoAttId = b.TryGetProperty("id", out var i) ? i.GetString() : null;
                if (linkedAdoId is { } tfs && adoUrl is not null)
                {
                    var patch = new[] { new { op = "add", path = "/relations/-", value = new { rel = "AttachedFile", url = adoUrl, attributes = new { name, comment = "הועלה דרך DCC" } } } };
                    await ado.SendAsync(projBase, $"wit/workitems/{tfs}", HttpMethod.Patch, patch, pat, ct: ct);
                }
            }
        }

        var id = await tenant.RunAsync(clientId, async d =>
        {
            var newId = await SqlJson.ScalarAsync<Guid>(d, """
                insert into attachment (client_id, workitem_id, name, ado_attachment_id, ado_url, content, extracted_text, extract_error, size_bytes, source, added_by)
                values (@c, @w, @n, @adoId, @adoUrl, @content, @text, @reason, @size, 'dcc', @by) returning id
                """, new { c = clientId, w = workitemId, n = name, adoId = adoAttId, adoUrl, content = bytes, text, reason, size = bytes.Length, by = actor }, ct);
            var he = CultureInfo.GetCultureInfo("he-IL");
            var body = $"📎 צורף קובץ: {name}" + (text is not null ? $" (נקרא — {text.Length.ToString("N0", he)} תווים)" : $" (לא נקרא כטקסט: {reason})");
            await events.AppendAsync(new NewEvent
            {
                ClientId = clientId, WorkitemId = workitemId, Source = "manual", Type = "note.added", Actor = new UserActor(actor),
                Payload = JsonSerializer.SerializeToElement(new { body }),
            }, ct);
            return newId;
        }, ct);
        await brief.RegenerateAsync(clientId, workitemId, ct);
        return new JsonObject { ["id"] = id.ToString(), ["name"] = name, ["adoUrl"] = adoUrl, ["textChars"] = text?.Length ?? 0, ["extractError"] = reason };
    }

    public sealed record Content(string Name, byte[]? Bytes, string? AdoUrl);

    public Task<Content?> ContentAsync(Guid clientId, Guid attachmentId, CancellationToken ct) =>
        tenant.RunAsync(clientId, async d =>
        {
            await using var cmd = new Npgsql.NpgsqlCommand("select name, content, ado_url from attachment where id = @id",
                (Npgsql.NpgsqlConnection)d.Database.GetDbConnectionSafe(), d.CurrentNpgsqlTransaction());
            cmd.Parameters.AddWithValue("id", attachmentId);
            await using var r = await cmd.ExecuteReaderAsync(ct);
            if (!await r.ReadAsync(ct)) return (Content?)null;
            return new Content(r.GetString(0), r.IsDBNull(1) ? null : (byte[])r[1], r.IsDBNull(2) ? null : r.GetString(2));
        }, ct);
}
