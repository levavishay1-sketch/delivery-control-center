using System.Collections.Concurrent;
using System.Diagnostics;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Dcc.Infrastructure.Claude;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Porta.Pty;

namespace Dcc.Infrastructure.Onboarding;

/// <summary>Bound from <c>Onboarding:Terminal</c>.</summary>
public sealed class OnboardingTerminalOptions
{
    public const string Section = "Onboarding:Terminal";

    /// <summary>
    /// The program the run's terminal starts instead of Claude Code — only to point it elsewhere (a test's stand-in).
    /// Unset, the terminal starts the same CLI every other call does: <c>DCC_CLAUDE_BIN</c>, then <c>Claude:Bin</c>.
    /// </summary>
    public string? Bin { get; set; }

    /// <summary>Arguments before Claude Code's own, with <see cref="Bin"/> (an interpreter and a script).</summary>
    public List<string> BinArgs { get; set; } = [];
}

/// <summary>
/// Turns the terminal's output bytes into text across reads. A Hebrew letter is two bytes in UTF-8 and a read can end
/// between them; decoding each read on its own would print two replacement marks where the letter was, so the
/// decoder keeps the unfinished bytes for the next read.
/// </summary>
public sealed class TerminalDecoder
{
    private readonly Decoder _decoder = new UTF8Encoding(encoderShouldEmitUTF8Identifier: false, throwOnInvalidBytes: false).GetDecoder();

    /// <summary>The text these bytes complete; <paramref name="flush"/> at the end of the stream turns what is left into a replacement mark.</summary>
    public string Decode(ReadOnlySpan<byte> bytes, bool flush = false)
    {
        var chars = new char[_decoder.GetCharCount(bytes, flush)];
        var n = _decoder.GetChars(bytes, chars, flush);
        return new string(chars, 0, n);
    }
}

/// <summary>What starting Claude Code in a run's terminal needs. <c>OnExit</c> gets the exit code (null when there was none).</summary>
public sealed record TerminalLaunch(Guid RunId, string Cwd, string SessionId, bool Resume, string? Model, string? Effort, Action<int?> OnExit);

/// <summary>
/// One terminal per onboarding run (session.ts): the real, interactive Claude Code in a pseudo-terminal, plus the lines
/// DCC itself prints (its git steps), in one stream the screen shows exactly as a terminal would. The person's
/// keystrokes go straight to Claude — slash commands, answers, Esc — so the session behaves as it does in a terminal,
/// because it is one.
///
/// The stream is kept in memory (the last 2,000,000 characters) and mirrored to <c>&lt;runtime&gt;/terminal.log</c>, so a
/// reconnect — or a restart — replays what was on screen. The process itself does not survive a restart; the same
/// conversation is reopened with <c>--resume &lt;session-id&gt;</c>.
///
/// No claude outlives the server: Porta.Pty puts the process in a Windows Job Object that kills its whole tree when the
/// job closes — so a crash of the server, which closes every handle, ends it too — and a kill here kills the tree.
/// </summary>
public sealed partial class OnboardingTerminal : IOnboardingTerminal, IDisposable
{
    private const int MaxBuffer = 2_000_000;
    /// <summary>Trimmed in steps, not on every chunk: copying two million characters per chunk of output would cost more than the output.</summary>
    private const int TrimSlack = 256 * 1024;
    private const int ReplayFromLog = 1_500_000;
    private static readonly TimeSpan IdleChannel = TimeSpan.FromMinutes(30);
    private static readonly UTF8Encoding Utf8 = new(encoderShouldEmitUTF8Identifier: false);

    private readonly IOptions<OnboardingOptions> _onboarding;
    private readonly IOptions<OnboardingTerminalOptions> _options;
    private readonly IOptions<ClaudeOptions> _claude;
    private readonly IHostEnvironment _env;
    private readonly ILogger<OnboardingTerminal> _log;

    private readonly ConcurrentDictionary<Guid, Channel> _channels = new();
    private readonly Lock _create = new();
    // What a channel let go of (an idle one is closed to free its buffer and its log handle) keeps answering as before.
    private readonly ConcurrentDictionary<Guid, string> _lastState = new();
    private readonly ConcurrentDictionary<Guid, Guid?> _lastInput = new();
    private readonly Timer _sweep;

    public OnboardingTerminal(IOptions<OnboardingOptions> onboarding, IOptions<OnboardingTerminalOptions> options, IOptions<ClaudeOptions> claude,
        IHostEnvironment env, ILogger<OnboardingTerminal> log)
    {
        _onboarding = onboarding;
        _options = options;
        _claude = claude;
        _env = env;
        _log = log;
        using (ExecutionContext.SuppressFlow())
            _sweep = new Timer(_ => Sweep(), null, TimeSpan.FromMinutes(10), TimeSpan.FromMinutes(10));
    }

    private sealed class Channel(Guid runId)
    {
        public readonly Guid RunId = runId;
        public readonly Lock Gate = new();
        public readonly StringBuilder Buf = new();
        public StreamWriter? Log;
        public readonly List<Action<TerminalMessage>> Listeners = [];
        public Session? Pty;
        public bool Starting;
        public string State = "none";
        public int Cols = 110;
        public int Rows = 32;
        public Guid? LastInputUser;
        public long LastUsed = Environment.TickCount64;
        /// <summary>Let go of by the sweep: whoever took it just before must look the run up again, or what it writes (or starts) is lost to the next viewer.</summary>
        public bool Retired;
    }

    private sealed class Session(IPtyConnection pty)
    {
        public readonly IPtyConnection Pty = pty;
        public readonly Lock WriteGate = new();
        public long LastRead = Environment.TickCount64;
        public int Exiting;
        public Thread? Reader;
    }

    /// <summary>Where the run's own files live — the same folder as <see cref="OnboardingWorkspace.RuntimeDir"/>, outside the copy.</summary>
    public string RuntimeDir(Guid runId) => Path.Combine(_onboarding.Value.WorkspaceRoot, "_runtime", runId.ToString());

    /// <summary>The latest status-line snapshot of the run's session.</summary>
    public string StatusFile(Guid runId) => Path.Combine(RuntimeDir(runId), "status.json");

    /// <summary>Server/onboarding/statusline.mjs — the status-line command the session's <c>--settings</c> points at.</summary>
    public string StatuslineScript
    {
        get
        {
            var data = _onboarding.Value.DataPath;
            var dir = Path.IsPathRooted(data) ? data : Path.GetFullPath(Path.Combine(_env.ContentRootPath, data));
            return Path.Combine(dir, "statusline.mjs");
        }
    }

    // ── the stream ───────────────────────────────────────────────────

    private Channel Get(Guid runId)
    {
        if (_channels.TryGetValue(runId, out var c)) return c;
        lock (_create)
        {
            if (_channels.TryGetValue(runId, out c)) return c;
            var dir = RuntimeDir(runId);
            Directory.CreateDirectory(dir);
            var logPath = Path.Combine(dir, "terminal.log");
            c = new Channel(runId)
            {
                State = _lastState.GetValueOrDefault(runId, "none"),
                LastInputUser = _lastInput.GetValueOrDefault(runId),
            };
            c.Buf.Append(ReadTail(logPath, ReplayFromLog));
            try
            {
                c.Log = new StreamWriter(new FileStream(logPath, FileMode.Append, FileAccess.Write, FileShare.ReadWrite | FileShare.Delete), Utf8) { AutoFlush = true };
            }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException)
            {
                _log.LogWarning(e, "onboarding terminal: {Log} cannot be written — the screen still works, a restart will not replay it", logPath);
            }
            _channels[runId] = c;
            return c;
        }
    }

    /// <summary>
    /// Runs <paramref name="fn"/> under the lock of the run's channel — a current one: a channel the sweep let go of
    /// between the lookup and the lock is looked up again (a fresh one reloads the log).
    /// </summary>
    private T Locked<T>(Guid runId, Func<Channel, T> fn)
    {
        while (true)
        {
            var c = Get(runId);
            lock (c.Gate)
            {
                if (!c.Retired) return fn(c);
            }
        }
    }

    /// <summary>The last <paramref name="bytes"/> of the log as text; a cut through a letter reads as a replacement mark, as Node's did.</summary>
    private static string ReadTail(string file, int bytes)
    {
        if (!File.Exists(file)) return "";
        try
        {
            using var fs = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
            var len = (int)Math.Min(fs.Length, bytes);
            fs.Seek(-len, SeekOrigin.End);
            var buf = new byte[len];
            fs.ReadExactly(buf);
            return Utf8.GetString(buf);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException) { return ""; }
    }

    private static void Notify(Channel c, TerminalMessage m)
    {
        // A listener only queues (the socket sends from its own loop), so calling it under the lock keeps every
        // listener's order equal to the buffer's without ever making the process wait for a browser.
        foreach (var l in c.Listeners.ToArray())
        {
            try { l(m); }
            catch (Exception) { /* one viewer's failure is not the session's */ }
        }
    }

    /// <summary>The process's own output: its channel is never swept while the process is there.</summary>
    private static void Emit(Channel c, string data)
    {
        lock (c.Gate) EmitLocked(c, data);
    }

    private static void EmitLocked(Channel c, string data)
    {
        c.Buf.Append(data);
        if (c.Buf.Length > MaxBuffer + TrimSlack) c.Buf.Remove(0, c.Buf.Length - MaxBuffer);
        try { c.Log?.Write(data); }
        catch (Exception e) when (e is IOException or ObjectDisposedException) { }
        c.LastUsed = Environment.TickCount64;
        Notify(c, new TerminalMessage("output", data));
    }

    private void SetState(Channel c, string state)
    {
        lock (c.Gate) SetStateLocked(c, state);
    }

    private void SetStateLocked(Channel c, string state)
    {
        c.State = state;
        _lastState[c.RunId] = state;
        Notify(c, new TerminalMessage("state", State: state));
    }

    [GeneratedRegex(@"\r?\n")] private static partial Regex LineBreak();

    public void Line(Guid runId, string text)
    {
        var data = $"\u001b[2m{LineBreak().Replace(text, "\r\n")}\u001b[0m\r\n";
        Locked(runId, c =>
        {
            EmitLocked(c, data);
            return 0;
        });
    }

    public string State(Guid runId) =>
        _channels.TryGetValue(runId, out var c) ? c.State : _lastState.GetValueOrDefault(runId, "none");

    public (string Replay, string State, IDisposable Subscription) Subscribe(Guid runId, Action<TerminalMessage> listener) =>
        // The snapshot and the subscription under one lock: nothing written between them is lost or sent twice.
        Locked(runId, c =>
        {
            c.Listeners.Add(listener);
            c.LastUsed = Environment.TickCount64;
            var replay = c.Buf.Length > MaxBuffer ? c.Buf.ToString(c.Buf.Length - MaxBuffer, MaxBuffer) : c.Buf.ToString();
            return (replay, c.State, (IDisposable)new Unsubscribe(c, listener));
        });

    private sealed class Unsubscribe(Channel c, Action<TerminalMessage> listener) : IDisposable
    {
        public void Dispose()
        {
            lock (c.Gate)
            {
                c.Listeners.Remove(listener);
                c.LastUsed = Environment.TickCount64;
            }
        }
    }

    public bool Input(Guid runId, string data, Guid? userId)
    {
        if (!_channels.TryGetValue(runId, out var c) || c.Pty is not { } s) return false;
        lock (c.Gate)
        {
            c.LastInputUser = userId;
            _lastInput[runId] = userId;
        }
        return Write(s, data);
    }

    public void Resize(Guid runId, int cols, int rows)
    {
        if (cols < 20 || rows < 5 || cols > 400 || rows > 200) return;
        var s = Locked(runId, c =>
        {
            c.Cols = cols;
            c.Rows = rows;
            return c.Pty;
        });
        try { s?.Pty.Resize(cols, rows); }
        catch (Exception) { /* the process may be exiting */ }
    }

    public Guid? LastInputUser(Guid runId) =>
        _channels.TryGetValue(runId, out var c) ? c.LastInputUser : _lastInput.GetValueOrDefault(runId);

    private static bool Write(Session s, string data)
    {
        var bytes = Utf8.GetBytes(data);
        lock (s.WriteGate)
        {
            try
            {
                s.Pty.WriterStream.Write(bytes);
                s.Pty.WriterStream.Flush();
                return true;
            }
            catch (Exception e) when (e is IOException or ObjectDisposedException or InvalidOperationException) { return false; }
        }
    }

    // ── the Claude Code process ──────────────────────────────────────

    /// <summary>
    /// <c>--settings</c> for the session: a status line that hands DCC the session's cost, model, effort and transcript
    /// path (Claude Code passes them to a status-line command) and shows a one-line summary in the terminal.
    /// </summary>
    private string WriteSessionSettings(Guid runId)
    {
        var file = Path.Combine(RuntimeDir(runId), "settings.json");
        var output = StatusFile(runId).Replace('\\', '/');
        var script = StatuslineScript.Replace('\\', '/');
        var settings = new JsonObject
        {
            ["statusLine"] = new JsonObject { ["type"] = "command", ["command"] = $"node \"{script}\" \"{output}\"", ["refreshInterval"] = 5 },
        };
        File.WriteAllText(file, settings.ToJsonString(SettingsJson), Utf8);
        return file;
    }

    private static readonly JsonSerializerOptions SettingsJson = new() { WriteIndented = true, NewLine = "\n", Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping };

    /// <summary>JavaScript's <c>\s</c> — an argument that holds one is shown quoted on the echo line.</summary>
    [GeneratedRegex("[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]")] private static partial Regex JsSpace();

    /// <summary>
    /// Starts Claude Code in the run's terminal: a new conversation that runs <c>/init</c>, or the same conversation
    /// again (<c>--resume</c>). Throws when one is already live, or when the process cannot be started.
    /// </summary>
    public async Task StartAsync(TerminalLaunch o, CancellationToken ct = default)
    {
        // Starting is set on a current channel, under its lock: the sweep never lets go of one that is starting.
        var c = Locked(o.RunId, ch =>
        {
            if (ch.Pty is not null || ch.Starting) throw new InvalidOperationException("סשן Claude כבר פעיל בהרצה הזו");
            ch.Starting = true;
            return ch;
        });
        try
        {
            var settings = WriteSessionSettings(o.RunId);
            var args = new List<string> { o.Resume ? "--resume" : "--session-id", o.SessionId, "--settings", settings };
            if (o.Model is { Length: > 0 } model) args.AddRange(["--model", model]);
            if (o.Effort is { Length: > 0 } effort) args.AddRange(["--effort", effort]);
            if (!o.Resume) args.Add("/init");
            var (file, prefix) = Command();

            // A resumed process repaints the conversation itself; drawn on top of the previous process's screen, its
            // cursor moves land in the old output. It starts on a clean screen (the full history stays in terminal.log).
            if (o.Resume) Emit(c, "\u001b[2J\u001b[3J\u001b[H");
            Line(o.RunId, $"dcc$ claude {string.Join(" ", args.Select(a => JsSpace().IsMatch(a) ? $"\"{a}\"" : a))}");

            var argv = prefix.Concat(args).ToArray();
            var pty = await PtyProvider.SpawnAsync(new PtyOptions
            {
                Name = "xterm-256color",
                Cols = c.Cols,
                Rows = c.Rows,
                Cwd = o.Cwd,
                App = file,
                // Windows takes one command line; Porta.Pty's own quoting mangles an argument that ends in a backslash.
                CommandLine = OperatingSystem.IsWindows() ? argv.Select(QuoteWindowsArg).ToArray() : argv,
                VerbatimCommandLine = OperatingSystem.IsWindows(),
                // A session started from a server that itself runs inside Claude Code must not think it is nested; an
                // empty value removes the variable from the inherited environment.
                // DCC_CAPTURE=off: this is DCC's own session, recorded by DCC in ledger slices — the capture hooks must not
                // record it a second time as the person whose credentials happen to sit on the server's account.
                Environment = new Dictionary<string, string> { ["CLAUDECODE"] = "", ["CLAUDE_CODE_ENTRYPOINT"] = "", ["CLAUDE_CODE_NEW_INIT"] = "1", ["DCC_CAPTURE"] = "off" },
            }, ct);

            var s = new Session(pty);
            lock (c.Gate)
            {
                c.Pty = s;
                c.Starting = false;
            }
            SetState(c, "live");
            s.Reader = new Thread(() => ReadLoop(c, s)) { IsBackground = true, Name = $"onboarding-terminal-{o.RunId.ToString()[..8]}" };
            s.Reader.UnsafeStart();
            pty.ProcessExited += (_, e) => Exited(c, s, e.ExitCode, o.OnExit);
            // A process that ended before the handler was attached never raises the event.
            if (pty.WaitForExit(0)) Exited(c, s, SafeExitCode(pty), o.OnExit);
        }
        catch
        {
            lock (c.Gate) c.Starting = false;
            throw;
        }
    }

    private static int? SafeExitCode(IPtyConnection pty)
    {
        try { return pty.ExitCode; }
        catch (Exception) { return null; }
    }

    private static void ReadLoop(Channel c, Session s)
    {
        var buffer = new byte[16 * 1024];
        var decoder = new TerminalDecoder();
        while (true)
        {
            int n;
            try { n = s.Pty.ReaderStream.Read(buffer, 0, buffer.Length); }
            catch (Exception) { break; }
            if (n <= 0) break;
            Interlocked.Exchange(ref s.LastRead, Environment.TickCount64);
            var text = decoder.Decode(buffer.AsSpan(0, n));
            if (text.Length > 0) Emit(c, text);
        }
        var rest = decoder.Decode([], flush: true);
        if (rest.Length > 0) Emit(c, rest);
    }

    private void Exited(Channel c, Session s, int? exitCode, Action<int?> onExit)
    {
        if (Interlocked.Exchange(ref s.Exiting, 1) == 1) return;
        using (ExecutionContext.SuppressFlow())
        {
            _ = Task.Run(async () =>
            {
                // What the process wrote last is still in the pipe: read it before the pseudo-console is closed, which
                // is also what ends the read (on Windows the pipe stays open after the process is gone).
                var waited = 0;
                while (waited < 1500 && Environment.TickCount64 - Interlocked.Read(ref s.LastRead) < 150)
                {
                    await Task.Delay(50);
                    waited += 50;
                }
                try { s.Pty.Dispose(); }
                catch (Exception) { /* already closed */ }
                s.Reader?.Join(TimeSpan.FromSeconds(3));
                lock (c.Gate)
                {
                    if (ReferenceEquals(c.Pty, s)) c.Pty = null;
                }
                Line(c.RunId, $"\r\n[סשן Claude הסתיים{(exitCode is int code && code != 0 ? $" (קוד {code})" : "")}]");
                SetState(c, "ended");
                try { onExit(exitCode); }
                catch (Exception e) { _log.LogError(e, "onboarding terminal {RunId}: the end of the session was not handled", c.RunId); }
            });
        }
    }

    /// <summary>
    /// <c>/exit</c> first, so Claude Code closes the conversation cleanly; the process tree is killed if it is still
    /// there after a few seconds.
    /// </summary>
    public async Task StopAsync(Guid runId, bool graceful = true)
    {
        if (!_channels.TryGetValue(runId, out var c) || c.Pty is not { } s) return;
        if (graceful)
        {
            // Esc closes an open menu first; the pause keeps the terminal from reading Esc + "/" as one Alt-key sequence.
            Write(s, "\u001b");
            await Task.Delay(250);
            Write(s, "/exit\r");
            for (var i = 0; i < 30 && c.Pty is not null; i++) await Task.Delay(200);
        }
        if (c.Pty is { } still) Kill(still);
    }

    private static void Kill(Session s)
    {
        int pid;
        try
        {
            pid = s.Pty.Pid;
            s.Pty.Kill();
            if (s.Pty.WaitForExit(2000)) return;
        }
        catch (Exception) { return; }
        // The job kills the tree; this is for a platform without one.
        try
        {
            using var p = Process.GetProcessById(pid);
            p.Kill(entireProcessTree: true);
        }
        catch (Exception) { /* already gone */ }
    }

    /// <summary>A session DCC knows about but whose process is gone (a restart of the server).</summary>
    public void MarkDisconnected(Guid runId) =>
        Locked(runId, c =>
        {
            if (c.Pty is null && !c.Starting) SetStateLocked(c, "disconnected");
            return 0;
        });

    /// <summary>At shutdown: every process tree is killed and every log closed.</summary>
    public void KillAll()
    {
        foreach (var c in _channels.Values)
        {
            if (c.Pty is { } s)
            {
                Kill(s);
                try { s.Pty.Dispose(); }
                catch (Exception) { }
            }
            lock (c.Gate)
            {
                try { c.Log?.Dispose(); }
                catch (Exception) { }
                c.Log = null;
            }
        }
    }

    /// <summary>A channel nobody watches and no process writes to for half an hour gives back its buffer and its log handle; the next viewer reads the log again.</summary>
    private void Sweep()
    {
        var now = Environment.TickCount64;
        foreach (var (id, c) in _channels)
        {
            lock (_create)
            {
                lock (c.Gate)
                {
                    if (c.Pty is not null || c.Starting || c.Listeners.Count > 0 || now - c.LastUsed < IdleChannel.TotalMilliseconds) continue;
                    _channels.TryRemove(id, out _);
                    c.Retired = true;
                    try { c.Log?.Dispose(); }
                    catch (Exception) { }
                    c.Log = null;
                }
            }
        }
    }

    public void Dispose()
    {
        _sweep.Dispose();
        KillAll();
    }

    /// <summary>
    /// The program to put in the terminal and the arguments before Claude Code's own. On Windows a global npm install
    /// exposes only a <c>claude.cmd</c> shim, and a pseudo-terminal needs a real executable, so the native binary the shim
    /// points at is used — or <c>claude.exe</c> from PATH (the native install) — falling back to <c>cmd.exe /c claude</c>.
    /// </summary>
    private (string File, List<string> Prefix) Command()
    {
        string bin;
        List<string> prefix;
        if (_options.Value.Bin is { Length: > 0 } own)
        {
            bin = own;
            prefix = [.. _options.Value.BinArgs];
        }
        else
        {
            bin = Environment.GetEnvironmentVariable("DCC_CLAUDE_BIN") is { Length: > 0 } env ? env : _claude.Value.Bin;
            prefix = [.. _claude.Value.BinArgs];
        }
        if (!OperatingSystem.IsWindows()) return (bin, prefix);

        var found = Path.IsPathRooted(bin) || bin.Contains('/') || bin.Contains('\\') ? (File.Exists(bin) ? Path.GetFullPath(bin) : null) : FindOnPath(bin);
        if (found is not null && !IsShim(found)) return (found, prefix);
        if (found is not null && NativeBehindShim(found) is { } exe) return (exe, prefix);
        return (Environment.GetEnvironmentVariable("ComSpec") ?? "cmd.exe", ["/c", bin, .. prefix]);
    }

    private static bool IsShim(string path) =>
        path.EndsWith(".cmd", StringComparison.OrdinalIgnoreCase) || path.EndsWith(".bat", StringComparison.OrdinalIgnoreCase);

    [GeneratedRegex("\"%dp0%\\\\([^\"]+?\\.exe)\"", RegexOptions.IgnoreCase)] private static partial Regex ShimTarget();

    private static string? NativeBehindShim(string shim)
    {
        try
        {
            var m = ShimTarget().Match(File.ReadAllText(shim));
            if (!m.Success) return null;
            var exe = Path.Combine(Path.GetDirectoryName(shim)!, m.Groups[1].Value);
            return File.Exists(exe) ? exe : null;
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException) { return null; }
    }

    /// <summary>A bare name the way Windows finds it: each PATH folder in turn, each PATHEXT extension in turn (a name with one is tried as it is first).</summary>
    private static string? FindOnPath(string name)
    {
        var exts = (Environment.GetEnvironmentVariable("PATHEXT") ?? ".COM;.EXE;.BAT;.CMD").Split(';', StringSplitOptions.RemoveEmptyEntries);
        foreach (var dir in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries))
        {
            try
            {
                if (Path.HasExtension(name) && File.Exists(Path.Combine(dir, name))) return Path.Combine(dir, name);
                foreach (var ext in exts)
                {
                    var candidate = Path.Combine(dir, name + ext);
                    if (File.Exists(candidate)) return candidate;
                }
            }
            catch (ArgumentException) { /* a malformed PATH entry */ }
        }
        return null;
    }

    /// <summary>One argument as the Windows C runtime reads it back: quoted when it has to be, backslashes doubled only before a quote.</summary>
    internal static string QuoteWindowsArg(string a)
    {
        if (a.Length > 0 && a.IndexOfAny([' ', '\t', '\n', '\v', '"']) < 0) return a;
        var sb = new StringBuilder("\"");
        for (var i = 0; i < a.Length; i++)
        {
            var slashes = 0;
            while (i < a.Length && a[i] == '\\')
            {
                slashes++;
                i++;
            }
            if (i == a.Length)
            {
                sb.Append('\\', slashes * 2);
                break;
            }
            if (a[i] == '"') sb.Append('\\', slashes * 2 + 1).Append('"');
            else sb.Append('\\', slashes).Append(a[i]);
        }
        return sb.Append('"').ToString();
    }
}
