using System.Diagnostics;
using System.Text;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Options;

namespace Dcc.Infrastructure.PullRequests;

/// <summary>Bound from <c>GitHub</c>.</summary>
public sealed class GitHubOptions
{
    public const string Section = "GitHub";

    /// <summary>The CLI. <c>DCC_GH_BIN</c> wins; empty = the usual install locations, then <c>gh</c> on PATH.</summary>
    public string? Bin { get; set; }

    /// <summary>Arguments before the CLI's own — lets a test point <see cref="Bin"/> at an interpreter and a stand-in script.</summary>
    public List<string> BinArgs { get; set; } = [];
}

/// <summary>
/// GitHub through the operator's own <c>gh</c> login (pull-requests.ts). The one place that runs it: no shell, every
/// argument one argument, a timeout that kills the tree. A server started before the CLI was installed does not have
/// it on PATH, so the usual install locations are tried first and a bare <c>gh</c> is the last resort.
/// </summary>
public sealed class GitHubCli(IOptions<GitHubOptions> options)
{
    public sealed record Result(int Code, string Out, string Err)
    {
        public bool Ok => Code == 0;
    }

    private string? _bin;
    private bool? _available;
    private string? _login;
    private bool _loginKnown;

    private string Bin()
    {
        if (Environment.GetEnvironmentVariable("DCC_GH_BIN") is { Length: > 0 } env) return env;
        if (options.Value.Bin is { Length: > 0 } configured) return configured;
        if (_bin is not null) return _bin;
        string[] candidates =
        [
            Path.Combine(Environment.GetEnvironmentVariable("ProgramFiles") ?? @"C:\Program Files", "GitHub CLI", "gh.exe"),
            Path.Combine(Environment.GetEnvironmentVariable("ProgramFiles(x86)") ?? @"C:\Program Files (x86)", "GitHub CLI", "gh.exe"),
            Path.Combine(Environment.GetEnvironmentVariable("LOCALAPPDATA") ?? "", "Programs", "GitHub CLI", "gh.exe"),
            "/usr/bin/gh", "/usr/local/bin/gh", "/opt/homebrew/bin/gh",
        ];
        return _bin = candidates.FirstOrDefault(File.Exists) ?? "gh";
    }

    public async Task<Result> RunAsync(IEnumerable<string> args, int timeoutMs = 30_000, CancellationToken ct = default)
    {
        var psi = new ProcessStartInfo(Bin())
        {
            RedirectStandardOutput = true, RedirectStandardError = true, RedirectStandardInput = true, UseShellExecute = false, CreateNoWindow = true,
            StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8,
        };
        foreach (var a in options.Value.BinArgs) psi.ArgumentList.Add(a);
        foreach (var a in args) psi.ArgumentList.Add(a);
        psi.Environment["GH_PROMPT_DISABLED"] = "1";
        psi.Environment["NO_COLOR"] = "1";
        Process p;
        try { p = Process.Start(psi)!; }
        catch (Exception e) { return new Result(127, "", e.Message); }
        using (p)
        {
            p.StandardInput.Close();
            var stdout = p.StandardOutput.ReadToEndAsync(CancellationToken.None);
            var stderr = p.StandardError.ReadToEndAsync(CancellationToken.None);
            using var limit = CancellationTokenSource.CreateLinkedTokenSource(ct);
            limit.CancelAfter(timeoutMs);
            try { await p.WaitForExitAsync(limit.Token); }
            catch (OperationCanceledException)
            {
                try { p.Kill(entireProcessTree: true); } catch (InvalidOperationException) { }
                return new Result(1, "", $"GitHub לא ענה תוך {timeoutMs / 1000} שניות");
            }
            return new Result(p.ExitCode, await stdout, await stderr);
        }
    }

    /// <summary>Is the CLI there at all? Asked once; a missing CLI is said in words on the screen, not as a failure per repository.</summary>
    public async Task<bool> AvailableAsync(CancellationToken ct)
    {
        if (_available is { } known) return known;
        var r = await RunAsync(["--version"], 8_000, ct);
        return (_available = r.Ok) is true;
    }

    /// <summary>One call that returns JSON, or null when the host could not answer.</summary>
    public async Task<JsonNode?> JsonAsync(IEnumerable<string> args, CancellationToken ct)
    {
        var r = await RunAsync(args, 30_000, ct);
        if (!r.Ok) return null;
        try { return JsonNode.Parse(r.Out.Length > 0 ? r.Out : "null"); }
        catch (System.Text.Json.JsonException) { return null; }
    }

    /// <summary>One call whose answer is text (a file's contents), or null when the host could not give it.</summary>
    public async Task<string?> TextAsync(IEnumerable<string> args, CancellationToken ct)
    {
        var r = await RunAsync(args, 30_000, ct);
        return r.Ok ? r.Out : null;
    }

    /// <summary>Which account <c>gh</c> acts as — the one a review is written by.</summary>
    public async Task<string?> LoginAsync(CancellationToken ct)
    {
        if (_loginKnown) return _login;
        _login = (await JsonAsync(["api", "user"], ct))?["login"]?.GetValue<string>();
        _loginKnown = true;
        return _login;
    }

    /// <summary>The first line of a refusal, for saying why in words.</summary>
    public static string Why(Result r) => r.Err.Split('\n').Select(l => l.Trim()).FirstOrDefault(l => l.Length > 0) ?? "";
}
