using System.Text.Json;
using Dcc.Application.Common;

namespace Dcc.Api.Infrastructure;

/// <summary>
/// Reading a PATCH body the way the old server's schemas did: a field that is
/// absent means "leave it", <c>null</c> means "clear it", anything else is the
/// new value — and a value of the wrong type is a 400, not a silent skip.
/// </summary>
public static class JsonBody
{
    public static bool Has(this JsonElement body, string name) =>
        body.ValueKind == JsonValueKind.Object && body.TryGetProperty(name, out var v) && v.ValueKind != JsonValueKind.Undefined;

    /// <summary>The field as text; null when absent or null. <paramref name="minLength"/> applies to a given value.</summary>
    public static string? Str(this JsonElement body, string name, int minLength = 0)
    {
        if (!body.Has(name)) return null;
        var v = body.GetProperty(name);
        if (v.ValueKind == JsonValueKind.Null) return null;
        if (v.ValueKind != JsonValueKind.String) throw AppException.BadRequest("bad_request", $"\"{name}\" must be text.");
        var s = v.GetString()!;
        if (s.Length < minLength) throw AppException.BadRequest("bad_request", $"\"{name}\" needs at least {minLength} characters.");
        return s;
    }

    /// <summary>A required text field.</summary>
    public static string Required(this JsonElement body, string name, int minLength = 1) =>
        body.Str(name, minLength) ?? throw AppException.BadRequest("bad_request", $"\"{name}\" is required.");

    public static int? Int(this JsonElement body, string name)
    {
        if (!body.Has(name)) return null;
        var v = body.GetProperty(name);
        if (v.ValueKind == JsonValueKind.Null) return null;
        if (v.ValueKind != JsonValueKind.Number || !v.TryGetInt32(out var n)) throw AppException.BadRequest("bad_request", $"\"{name}\" must be a whole number.");
        return n;
    }

    public static bool? Bool(this JsonElement body, string name)
    {
        if (!body.Has(name)) return null;
        var v = body.GetProperty(name);
        return v.ValueKind switch
        {
            JsonValueKind.Null => null,
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            _ => throw AppException.BadRequest("bad_request", $"\"{name}\" must be true or false."),
        };
    }

    public static Guid? Uuid(this JsonElement body, string name)
    {
        var s = body.Str(name);
        if (s is null) return null;
        return Guid.TryParse(s, out var g) ? g : throw AppException.BadRequest("bad_request", $"\"{name}\" must be an id.");
    }

    public static JsonElement? Obj(this JsonElement body, string name)
    {
        if (!body.Has(name)) return null;
        var v = body.GetProperty(name);
        if (v.ValueKind == JsonValueKind.Null) return null;
        return v.ValueKind == JsonValueKind.Object ? v : throw AppException.BadRequest("bad_request", $"\"{name}\" must be an object.");
    }

    /// <summary>An absolute http(s) URL, as the old schemas' <c>z.string().url()</c>.</summary>
    public static string Url(this JsonElement body, string name)
    {
        var s = body.Required(name);
        return Uri.TryCreate(s.Trim(), UriKind.Absolute, out var u) && (u.Scheme == "http" || u.Scheme == "https")
            ? s
            : throw AppException.BadRequest("bad_request", $"\"{name}\" must be a URL.");
    }
}
