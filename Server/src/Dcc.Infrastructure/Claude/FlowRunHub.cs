using System.Collections.Concurrent;
using System.Diagnostics;
using System.Text.Json;

namespace Dcc.Infrastructure.Claude;

/// <summary>
/// The live side of flow runs, which exists only in this process's memory (ai-assist.ts): each run's
/// transcript while it runs (so a poll never touches the database during a spawn of minutes), the step a
/// task's run is in, and the claude processes that can be stopped or handed more text. The durable side is
/// the <c>flow_run</c> row, written when the run ends.
/// </summary>
public sealed class FlowRunHub
{
    public sealed class Buffer(string kind, Guid workitemId, Guid? taskId)
    {
        public List<string> Lines { get; } = [];
        public string Kind { get; } = kind;
        public Guid WorkitemId { get; } = workitemId;
        public Guid? TaskId { get; } = taskId;
        /// <summary>Its row is written; kept a little while only so a polling screen gets the last lines.</summary>
        public volatile bool Finished;
        public volatile string? Phase;
    }

    private sealed class Steerable(Process process)
    {
        public Process Process { get; } = process;
        public volatile bool StdinOpen = true;
        public volatile bool StoppedByUser;
    }

    private readonly ConcurrentDictionary<Guid, Buffer> _buffers = new();
    private readonly ConcurrentDictionary<Guid, Steerable> _procs = new();

    public Buffer Open(Guid runId, string kind, Guid workitemId, Guid? taskId) => _buffers[runId] = new Buffer(kind, workitemId, taskId);

    public Buffer? Get(Guid runId) => _buffers.GetValueOrDefault(runId);

    public void Finish(Guid runId)
    {
        if (!_buffers.TryGetValue(runId, out var b)) return;
        b.Finished = true;
        _ = Task.Delay(20_000).ContinueWith(_ => _buffers.TryRemove(runId, out Buffer? _), TaskScheduler.Default);
    }

    public List<string> Lines(Guid runId)
    {
        if (!_buffers.TryGetValue(runId, out var b)) return [];
        lock (b.Lines) return [.. b.Lines];
    }

    public void PushLine(Guid? runId, string line)
    {
        if (runId is not { } id || !_buffers.TryGetValue(id, out var b)) return;
        lock (b.Lines)
        {
            b.Lines.Add(line);
            if (b.Lines.Count > 4000) b.Lines.RemoveRange(0, b.Lines.Count - 4000);
        }
    }

    public void SetPhase(Guid? runId, string phase)
    {
        if (runId is { } id && _buffers.TryGetValue(id, out var b)) b.Phase = phase;
    }

    /// <summary>The step a task's run is in right now, or null when none of its runs is going on.</summary>
    public string? LiveTaskPhase(Guid taskId)
    {
        foreach (var b in _buffers.Values) if (b.TaskId == taskId && !b.Finished) return b.Phase ?? "develop";
        return null;
    }

    /// <summary>A run still going on for this requirement (taskId null) or this task.</summary>
    public (Guid Id, Buffer Buffer)? Live(Guid workitemId, Guid? taskId)
    {
        foreach (var (id, b) in _buffers)
            if (!b.Finished && (taskId is { } t ? b.TaskId == t : b.WorkitemId == workitemId && b.TaskId is null)) return (id, b);
        return null;
    }

    internal void Attach(Guid runId, Process p) => _procs[runId] = new Steerable(p);

    internal void Detach(Guid runId) => _procs.TryRemove(runId, out _);

    internal bool WasStopped(Guid runId) => _procs.TryGetValue(runId, out var s) && s.StoppedByUser;

    internal void CloseStdin(Guid runId)
    {
        if (!_procs.TryGetValue(runId, out var s) || !s.StdinOpen) return;
        s.StdinOpen = false;
        try { s.Process.StandardInput.Close(); } catch (Exception e) when (e is IOException or InvalidOperationException) { }
    }

    /// <summary>Stop a live run — the whole process tree. False if it already finished or was never steerable.</summary>
    public bool Stop(Guid runId)
    {
        if (!_procs.TryGetValue(runId, out var s)) return false;
        s.StoppedByUser = true;
        try { s.Process.Kill(entireProcessTree: true); } catch (InvalidOperationException) { return false; }
        return true;
    }

    /// <summary>Shutdown: no claude child is left running (and spending) with nobody to collect its result.</summary>
    public int StopAll()
    {
        var n = 0;
        foreach (var (id, s) in _procs)
        {
            s.StoppedByUser = true;
            try { s.Process.Kill(entireProcessTree: true); n++; } catch (InvalidOperationException) { }
            _procs.TryRemove(id, out _);
        }
        return n;
    }

    /// <summary>Hand a live run more text — Claude sees it as it continues; it does not interrupt the current step.</summary>
    public bool SendMessage(Guid runId, string text)
    {
        if (!_procs.TryGetValue(runId, out var s) || !s.StdinOpen) return false;
        try
        {
            s.Process.StandardInput.WriteLine(UserMessage(text));
            s.Process.StandardInput.Flush();
        }
        catch (Exception e) when (e is IOException or InvalidOperationException) { return false; }
        PushLine(runId, $"🗣 הוספת מלל: {text}");
        return true;
    }

    internal static string UserMessage(string text) =>
        JsonSerializer.Serialize(new { type = "user", message = new { role = "user", content = new[] { new { type = "text", text } } } });
}
