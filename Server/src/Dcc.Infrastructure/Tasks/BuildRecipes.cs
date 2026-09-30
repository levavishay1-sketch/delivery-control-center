using System.Diagnostics;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace Dcc.Infrastructure.Tasks;

public sealed record BuildRecipe(string Tool, string Command, IReadOnlyList<string> Args, string Cwd, string Project);

/// <summary>build (recipes + notes) / nothing (reason) / cannot (reason).</summary>
public sealed record BuildPlan(string Kind, IReadOnlyList<BuildRecipe>? Recipes = null, IReadOnlyList<string>? Notes = null, string? Reason = null)
{
    public static BuildPlan Nothing(string reason) => new("nothing", Reason: reason);
    public static BuildPlan Cannot(string reason) => new("cannot", Reason: reason);
}

public sealed record BuildPlanInput(string Dir, IReadOnlyList<string> Files, IReadOnlyList<string> Changed, IReadOnlyList<string> Declared, Func<string, Task<string?>> Read, string? Msbuild);

/// <summary>
/// The build check, without AI, for every task the same way: build the projects that hold the files
/// the task changed, and the compiled components the breakdown named for it — with the real command.
/// Nothing compiled changed → nothing to build; a source file DCC cannot build → said plainly.
/// Extend the detectors here, not the mechanism, when a new ecosystem shows up (build-recipe.ts).
/// </summary>
public static partial class BuildRecipes
{
    [GeneratedRegex(@"\.(csproj|vbproj|fsproj)$", RegexOptions.IgnoreCase)] private static partial Regex DotnetProject();
    [GeneratedRegex(@"\.(cs|vb|fs|java|kt|scala|go|rs|c|cc|cpp|cxx|h|hpp|swift)$", RegexOptions.IgnoreCase)] private static partial Regex MustCompile();
    [GeneratedRegex(@"(^|/)package\.json$", RegexOptions.IgnoreCase)] private static partial Regex PackageJson();
    [GeneratedRegex(@"<Project\s+Sdk=", RegexOptions.IgnoreCase)] private static partial Regex SdkAttr();
    [GeneratedRegex(@"ToolsVersion\s*=", RegexOptions.IgnoreCase)] private static partial Regex ToolsVersion();

    private static string DirOf(string rel) => rel.Contains('/') ? rel[..rel.LastIndexOf('/')] : "";

    /// <summary>SDK-style vs legacy (ToolsVersion, or a packages.config beside it — needs the classic desktop MSBuild).</summary>
    public static string ClassifyCsproj(string xml, bool hasPackagesConfig)
    {
        if (SdkAttr().IsMatch(xml)) return "sdk";
        if (ToolsVersion().IsMatch(xml) || hasPackagesConfig) return "legacy";
        return "sdk";
    }

    /// <summary>Where the classic desktop MSBuild lives — DCC_MSBUILD_PATH first, then the common install paths.</summary>
    public static string? FindClassicMsbuild()
    {
        var env = Environment.GetEnvironmentVariable("DCC_MSBUILD_PATH");
        if (!string.IsNullOrEmpty(env) && File.Exists(env)) return env;
        string[] roots = [@"C:\Program Files\Microsoft Visual Studio\2022", @"C:\Program Files (x86)\Microsoft Visual Studio\2022"];
        string[] editions = ["BuildTools", "Community", "Professional", "Enterprise"];
        foreach (var root in roots)
            foreach (var ed in editions)
            {
                var p = Path.Combine(root, ed, "MSBuild", "Current", "Bin", "amd64", "MSBuild.exe");
                if (File.Exists(p)) return p;
            }
        return null;
    }

    private static async Task<bool> HasBuildScript(Func<string, Task<string?>> read, string rel)
    {
        try
        {
            using var doc = JsonDocument.Parse(await read(rel) ?? "{}");
            return doc.RootElement.TryGetProperty("scripts", out var s) && s.ValueKind == JsonValueKind.Object
                && s.TryGetProperty("build", out var b) && b.ValueKind == JsonValueKind.String && b.GetString()!.Length > 0;
        }
        catch (JsonException) { return false; }
    }

    private static async Task<string?> PackageName(Func<string, Task<string?>> read, string rel)
    {
        try
        {
            using var doc = JsonDocument.Parse(await read(rel) ?? "{}");
            return doc.RootElement.TryGetProperty("name", out var n) && n.ValueKind == JsonValueKind.String ? n.GetString() : null;
        }
        catch (JsonException) { return null; }
    }

    private static async Task<(BuildRecipe? Recipe, string? Why)> RecipeFor(BuildPlanInput input, string rel)
    {
        var abs = Path.Combine(input.Dir, rel);
        if (rel.EndsWith("package.json", StringComparison.OrdinalIgnoreCase))
            return (new BuildRecipe("npm", "npm", ["run", "build"], Path.GetDirectoryName(abs)!, rel), null);
        var d = DirOf(rel);
        var hasPackagesConfig = input.Files.Contains($"{(d.Length > 0 ? d + "/" : "")}packages.config");
        if (ClassifyCsproj(await input.Read(rel) ?? "", hasPackagesConfig) == "sdk")
            return (new BuildRecipe("dotnet", "dotnet", ["build", abs], input.Dir, rel), null);
        if (input.Msbuild is null) return (null, $"{rel} הוא פרויקט .NET ישן (ToolsVersion/packages.config) שצריך MSBuild קלאסי — לא נמצא במחשב הזה");
        return (new BuildRecipe("msbuild", input.Msbuild, [abs, "-nologo", "-verbosity:quiet"], input.Dir, rel), null);
    }

    /// <summary>What building this task means: the nearest project above each changed file, and the named components by name.</summary>
    public static async Task<BuildPlan> PlanAsync(BuildPlanInput input)
    {
        if (input.Changed.Count == 0) return BuildPlan.Nothing("המשימה לא שינתה אף קובץ");
        var byDir = new Dictionary<string, List<string>>();
        foreach (var f in input.Files)
        {
            if (!DotnetProject().IsMatch(f) && !PackageJson().IsMatch(f)) continue;
            var d = DirOf(f);
            if (!byDir.TryGetValue(d, out var list)) byDir[d] = list = [];
            list.Add(f);
        }

        var projects = new List<string>();
        var notes = new List<string>();
        void Add(string p) { if (!projects.Contains(p)) projects.Add(p); }

        foreach (var file in input.Changed)
        {
            string? found = null;
            var settled = false;
            for (var d = DirOf(file); !settled; d = DirOf(d))
            {
                var here = byDir.GetValueOrDefault(d) ?? [];
                var dotnet = here.Where(f => DotnetProject().IsMatch(f)).ToList();
                if (dotnet.Count > 1) return BuildPlan.Cannot($"בתיקייה {(d.Length > 0 ? d : "/")} יש כמה קבצי פרויקט ({string.Join(", ", dotnet)}) — לא ברור לאיזה מהם {file} שייך");
                if (dotnet.Count == 1) { found = dotnet[0]; settled = true; break; }
                var pkg = here.FirstOrDefault(f => f.EndsWith("package.json", StringComparison.OrdinalIgnoreCase));
                if (pkg is not null) { if (await HasBuildScript(input.Read, pkg)) found = pkg; settled = true; break; }
                if (d.Length == 0) break;
            }
            if (found is not null) Add(found);
            else if (!settled && MustCompile().IsMatch(file))
                return BuildPlan.Cannot($"DCC לא מזהה איך לבנות את {file} — הוא לא בתוך פרויקט שהוא מכיר (.csproj / package.json)");
        }

        foreach (var name in input.Declared)
        {
            var dotnet = input.Files.Where(f => DotnetProject().IsMatch(f)
                && DotnetProject().Replace(f[(f.LastIndexOf('/') + 1)..], "").Equals(name, StringComparison.OrdinalIgnoreCase)).ToList();
            if (dotnet.Count > 1) return BuildPlan.Cannot($"כמה קבצי פרויקט בשם {name} ({string.Join(", ", dotnet)}) — לא ברור איזה לבנות");
            if (dotnet.Count == 1) { Add(dotnet[0]); continue; }
            string? pkg = null;
            foreach (var f in input.Files.Where(x => PackageJson().IsMatch(x)))
                if (await PackageName(input.Read, f) == name) { pkg = f; break; }
            if (pkg is not null && await HasBuildScript(input.Read, pkg)) Add(pkg);
            else notes.Add($"הרכיב {name} שהוגדר למשימה לא נמצא במאגר כפרויקט שנבנה — לא נבנה");
        }

        if (projects.Count == 0) return BuildPlan.Nothing("הקבצים שהשתנו לא שייכים לאף פרויקט שמתקמפל (למשל הגדרות או תיעוד)");
        var recipes = new List<BuildRecipe>();
        foreach (var p in projects)
        {
            var (r, why) = await RecipeFor(input, p);
            if (r is null) return BuildPlan.Cannot(why!);
            recipes.Add(r);
        }
        return new BuildPlan("build", recipes, notes);
    }

    /// <summary>The plan as a person reads it before running it: the exact commands, or why there are none.</summary>
    public static string Describe(BuildPlan plan) => plan.Kind switch
    {
        "nothing" => $"אין מה לבנות: {plan.Reason}",
        "cannot" => $"אי אפשר לבנות כאן: {plan.Reason}",
        _ => string.Join("\n", plan.Recipes!.Select(r => $"{r.Command} {string.Join(" ", r.Args)}").Concat(plan.Notes!.Select(n => $"({n})"))),
    };

    /// <summary>Runs one recipe directly — no AI. Combined output and whether it passed.</summary>
    public static async Task<(bool Passed, string Out)> RunAsync(BuildRecipe recipe, int timeoutMs = 600_000, CancellationToken ct = default)
    {
        // npm is a .cmd on Windows, started through cmd; its arguments here are fixed words.
        var viaCmd = recipe.Tool == "npm" && OperatingSystem.IsWindows();
        var psi = new ProcessStartInfo(viaCmd ? "cmd.exe" : recipe.Command)
        {
            WorkingDirectory = recipe.Cwd, RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false, CreateNoWindow = true,
        };
        if (viaCmd) { psi.ArgumentList.Add("/c"); psi.ArgumentList.Add(recipe.Command); }
        foreach (var a in recipe.Args) psi.ArgumentList.Add(a);
        var output = new StringBuilder();
        Process p;
        try { p = Process.Start(psi)!; }
        catch (Exception e) { return (false, $"{recipe.Command} לא נמצא: {e.Message}"); }
        using (p)
        {
            p.OutputDataReceived += (_, e) => { if (e.Data is not null) lock (output) output.AppendLine(e.Data); };
            p.ErrorDataReceived += (_, e) => { if (e.Data is not null) lock (output) output.AppendLine(e.Data); };
            p.BeginOutputReadLine();
            p.BeginErrorReadLine();
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
            timeout.CancelAfter(timeoutMs);
            try { await p.WaitForExitAsync(timeout.Token); }
            catch (OperationCanceledException)
            {
                try { p.Kill(entireProcessTree: true); } catch (InvalidOperationException) { }
                lock (output) return (false, $"{output}\n\n(נעצר — לא הסתיים תוך {timeoutMs / 1000}s)");
            }
            p.WaitForExit();
            lock (output) return (p.ExitCode == 0, output.ToString().Trim());
        }
    }
}
