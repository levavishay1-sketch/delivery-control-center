using Dcc.Application.Common;
using Dcc.Infrastructure.Chat;

namespace Dcc.Infrastructure.PullRequests;

/// <summary>
/// What a code reading on a pull request reads (chat/proposals.ts): the change itself, fetched from the host into the
/// conversation's own folder — never a local clone, which may not have the branch at all.
/// </summary>
public sealed class PullRequestChatCode(PullRequestService prs) : IChatCodeSource
{
    public string Kind => "pr";

    public async Task<(string? Dir, string Holds, string SystemKey, IReadOnlyList<string> ExtraDirs)> CodeForReadingAsync(ResolvedTopic topic, string conversationDir, CancellationToken ct)
    {
        var parts = (topic.Id ?? "").Split('/');
        if (parts.Length != 2 || !Guid.TryParse(parts[0], out var repoId) || !int.TryParse(parts[1], out var number)) throw new ChatRefused("חסר מזהה בקשת מיזוג");
        var dir = Path.Combine(conversationDir, "change");
        try { return (dir, await prs.WriteCodeAsync(repoId, number, dir, ct), "chat.code_read.pull_request", []); }
        catch (AppException e) { throw new ChatRefused(e.Message); }
    }
}
