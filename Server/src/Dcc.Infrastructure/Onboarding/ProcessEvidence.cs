using System.Text;
using System.Text.Json.Nodes;
using Dcc.Domain.Onboarding;

namespace Dcc.Infrastructure.Onboarding;

/// <summary>
/// The process evidence of a run (gatherEvidence in repo-onboarding/processes.ts): what <see cref="Processes.GatherEvidence"/>
/// decides from the profile, with the contribution rules and the pull-request template read from the run's isolated
/// copy. Without a copy (no folder yet) they are only named.
/// </summary>
public static class ProcessEvidenceReader
{
    public static List<ProcessEvidence> Gather(JsonObject profile, string? dir) =>
        Processes.GatherEvidence(profile, string.IsNullOrEmpty(dir) ? null : (relative, limit) => Read(dir, relative, limit));

    /// <summary>
    /// A file of the copy, cut to <paramref name="limit"/> UTF-16 units; null when it is not there or cannot be read.
    /// Decoded as UTF-8 without dropping a byte-order mark, as Node's readFileSync(…, "utf8") did.
    /// </summary>
    private static string? Read(string dir, string relative, int limit)
    {
        var path = Path.Join(dir, relative);
        try
        {
            if (!File.Exists(path)) return null;
            var text = Encoding.UTF8.GetString(File.ReadAllBytes(path));
            return text.Length <= limit ? text : text[..limit];
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            return null;
        }
    }
}
