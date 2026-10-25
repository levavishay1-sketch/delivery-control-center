using Dcc.Domain.Git;
using Dcc.Domain.PullRequests;

namespace Dcc.Infrastructure.PullRequests;

/// <summary>A repository as the pull-request centre reads it: where it lives on its host, and which client it belongs to.</summary>
public sealed record PrRepoRow(Guid Id, string Name, string? AdoRepoRef, string? LocalPath, Guid? ClientId, string? ClientName)
{
    /// <summary>The repository's https address on its host, or null when it has no git address.</summary>
    public string? Url => AdoRepoRef is { } r && (r.StartsWith("http://", StringComparison.Ordinal) || r.StartsWith("https://", StringComparison.Ordinal) || r.StartsWith("git@", StringComparison.Ordinal))
        ? Repos.Git.HttpsRepoUrl(r) : null;

    public Repos.RepoRef Ref => new(Id, Name, LocalPath, AdoRepoRef);
}

/// <summary>
/// What a host says about one request, before DCC decides anything from it. <c>OurFiles</c> / <c>TheirFiles</c> null:
/// the live comparison could not be made (the request is closed, or the host did not answer).
/// </summary>
public sealed record HostDetail
{
    public string Body { get; init; } = "";
    /// <summary>The request's files when the comparison is unavailable.</summary>
    public IReadOnlyList<HostFile> Files { get; init; } = [];
    /// <summary>What the branch changed since it left the base.</summary>
    public IReadOnlyList<HostFile>? OurFiles { get; init; }
    /// <summary>What the base changed since the branch left it.</summary>
    public IReadOnlyList<HostFile>? TheirFiles { get; init; }
    public IReadOnlyList<CodeMapCommit> OurCommits { get; init; } = [];
    public IReadOnlyList<CodeMapCommit> TheirCommits { get; init; } = [];
    public CodeMapCommit? MergeBase { get; init; }
    /// <summary>The full commit ids a file is compared between.</summary>
    public string? MergeBaseSha { get; init; }
    public string? HeadSha { get; init; }
    public int Ahead { get; init; }
    public int Behind { get; init; }
    /// <summary>Reviews and comments, already in words.</summary>
    public IReadOnlyList<PrTimelineItem> Conversation { get; init; } = [];
}

/// <summary>
/// The seam between DCC and a git host (pull-requests.ts <c>Provider</c>). GitHub speaks through the operator's own
/// <c>gh</c> login; Azure DevOps through the owning client's service connection. A caller never knows which.
/// Refusals are <see cref="Application.Common.AppException"/>s with a sentence for the person.
/// </summary>
public interface IPullRequestHost
{
    /// <summary>github or ado.</summary>
    string Id { get; }

    bool Handles(PrRepoRow repo);

    /// <summary>Why this host cannot be read for this repository right now (no CLI, no connection) — null when it can.</summary>
    Task<string?> UnavailableAsync(PrRepoRow repo, CancellationToken ct);

    /// <summary>The open requests and the recent merged or closed ones. Throws <see cref="InvalidOperationException"/> with the host's reason.</summary>
    Task<(IReadOnlyList<PullRequestRow> Open, IReadOnlyList<PullRequestRow> Done)> ListAsync(PrRepoRow repo, CancellationToken ct);

    Task<HostDetail> DetailAsync(PrRepoRow repo, PullRequestRow pr, CancellationToken ct);

    /// <summary>A file's text at a commit, or null when the host could not give it.</summary>
    Task<string?> ContentAsync(PrRepoRow repo, string path, string commit, CancellationToken ct);

    /// <summary>Where a file at a ref lives on the host, for a person to open.</summary>
    string BlobUrl(PrRepoRow repo, string @ref, string path);

    /// <summary>The whole change as a unified diff, or null when the host has none to give.</summary>
    Task<string?> DiffAsync(PrRepoRow repo, PullRequestRow pr, CancellationToken ct);

    /// <summary>A review written in DCC: comment, approve or request_changes.</summary>
    Task ReviewAsync(PrRepoRow repo, PullRequestRow pr, string decision, string text, CancellationToken ct);

    /// <summary>The host's own merge.</summary>
    Task MergeAsync(PrRepoRow repo, PullRequestRow pr, CancellationToken ct);

    Task<RepoBranches> BranchesAsync(PrRepoRow repo, CancellationToken ct);
}
