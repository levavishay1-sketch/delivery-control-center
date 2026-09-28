namespace Dcc.Infrastructure.Ado;

/// <summary>
/// Makes sense of whatever a person pasted as an Azure DevOps URL. Pure.
/// Cloud (dev.azure.com / *.visualstudio.com): the org is the first segment.
/// On-prem Server: the collection is the first segment, after an optional
/// <c>/tfs/</c> virtual directory. Anything after a <c>_</c> marker (<c>_git</c>,
/// <c>_apis</c>) is not part of it; the segment after the org/collection is the project.
/// </summary>
public static class AdoUrl
{
    public static (string OrgUrl, string ProjectFromUrl) Split(string rawOrgUrl)
    {
        var raw = rawOrgUrl.Trim().TrimEnd('/');
        if (!Uri.TryCreate(raw, UriKind.Absolute, out var u) || (u.Scheme != "http" && u.Scheme != "https"))
            return (raw, "");

        var segs = u.AbsolutePath.Split('/', StringSplitOptions.RemoveEmptyEntries).Select(Uri.UnescapeDataString).ToList();
        var marker = segs.FindIndex(s => s.StartsWith('_'));
        if (marker >= 0) segs = segs[..marker];

        var host = u.Host;
        var isCloud = host.Equals("dev.azure.com", StringComparison.OrdinalIgnoreCase)
                      || host.EndsWith(".dev.azure.com", StringComparison.OrdinalIgnoreCase)
                      || host.EndsWith(".visualstudio.com", StringComparison.OrdinalIgnoreCase);
        var baseLen = isCloud ? 1 : (segs.Count > 0 && segs[0].Equals("tfs", StringComparison.OrdinalIgnoreCase) ? 2 : 1);

        var baseSegs = segs.Take(baseLen).ToList();
        var rest = segs.Skip(baseLen).ToList();
        var origin = u.GetLeftPart(UriPartial.Authority);
        var orgUrl = origin + (baseSegs.Count > 0 ? "/" + string.Join('/', baseSegs) : "");
        return (orgUrl, rest.FirstOrDefault() ?? "");
    }

    /// <summary>The project pasted inside the URL wins over the one typed separately.</summary>
    public static (string OrgUrl, string Project) Normalise(string rawOrgUrl, string rawProject)
    {
        var (orgUrl, fromUrl) = Split(rawOrgUrl);
        return (orgUrl, (fromUrl.Length > 0 ? fromUrl : rawProject ?? "").Trim());
    }
}
