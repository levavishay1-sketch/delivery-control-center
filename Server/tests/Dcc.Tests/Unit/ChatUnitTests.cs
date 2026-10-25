using System.Text.Json.Nodes;
using Dcc.Domain.Chat;
using Dcc.Infrastructure.Claude;

namespace Dcc.Tests.Unit;

/// <summary>The old chat/blocks and chat/gaps-prompt tests, and the CLI's stream-json reading.</summary>
public sealed class ChatBlocksTests
{
    [Fact]
    public void Keeps_plain_text_as_is()
    {
        var r = ChatBlocks.Parse("שלום, אין כאן בלוקים.");
        Assert.Equal("שלום, אין כאן בלוקים.", r.Text);
        Assert.Empty(r.Actions);
        Assert.Null(r.NeedsCode);
        Assert.Null(r.Goto);
    }

    [Fact]
    public void Reads_one_action_with_its_parameters()
    {
        var r = ChatBlocks.Parse("אני מציע לסגור.\n<action key=\"resolve_gap\">{\"gap\":\"1a2b3c4d\",\"answer\":\"כן\"}</action>");
        Assert.Equal("אני מציע לסגור.", r.Text);
        var a = Assert.Single(r.Actions);
        Assert.Equal("resolve_gap", a.Key);
        Assert.Equal("1a2b3c4d", a.Params["gap"]!.GetValue<string>());
    }

    [Fact]
    public void Reads_several_actions_in_order()
    {
        var r = ChatBlocks.Parse("שני פערים נסגרו:\n<action key=\"resolve_gap\">{\"gap\":\"aaaaaaaa\",\"answer\":\"א\"}</action>\n<action key=\"dismiss_gap\">{\"gap\":\"bbbbbbbb\",\"reason\":\"ב\"}</action>");
        Assert.Equal(["resolve_gap", "dismiss_gap"], r.Actions.Select(a => a.Key));
        Assert.Equal("ב", r.Actions[1].Params["reason"]!.GetValue<string>());
        Assert.Equal("שני פערים נסגרו:", r.Text);
    }

    [Fact]
    public void A_body_that_is_not_an_object_gives_no_parameters()
    {
        Assert.Empty(Assert.Single(ChatBlocks.Parse("<action key=\"assess\">not json</action>").Actions).Params);
        Assert.Empty(Assert.Single(ChatBlocks.Parse("<action key=\"x\">[\"a\"]</action>").Actions).Params);
    }

    [Fact]
    public void Caps_the_actions_of_one_answer()
    {
        var many = string.Join("\n", Enumerable.Range(0, 20).Select(i => $"<action key=\"k{i}\">{{}}</action>"));
        var r = ChatBlocks.Parse($"טקסט\n{many}");
        Assert.Equal(12, r.Actions.Count);
        Assert.Equal("טקסט", r.Text);
    }

    [Fact]
    public void Reads_needs_code_and_goto()
    {
        var r = ChatBlocks.Parse("תשובה חלקית.\n<needs_code>לקרוא את מנוע המעבר</needs_code>\n<goto key=\"flow\">לראות את התרשים</goto>");
        Assert.Equal("לקרוא את מנוע המעבר", r.NeedsCode);
        Assert.Equal(("flow", "לראות את התרשים"), r.Goto);
        Assert.Equal("תשובה חלקית.", r.Text);
    }
}

public sealed class GapsPromptTests
{
    private static GapLike Gap(string state = "proposed", string? answer = null, string id = "1a2b3c4d-0000-4000-8000-000000000000", string description = "מי מאשר את בקשת הביטול?") =>
        new(id, description, "לא מוגדר גורם מאשר", "הבקשה תיתקע", ["מנהל הצוות", "מנהל הבקרה"], "client", true, state, answer);

    private static GapsContextInput Base(IReadOnlyList<GapLike>? gaps = null, bool noRepo = false, bool repoAvailable = true, IReadOnlyList<(string, string?, string?)>? files = null) =>
        new("ביטול טופס", "development", noRepo ? null : ("trade", repoAvailable), [("manual", "נציג יוכל לבקש ביטול")], files ?? [], gaps ?? [Gap()]);

    [Fact]
    public void Lists_an_open_gap_with_its_short_reference_and_what_the_model_needs()
    {
        var t = GapsPrompt.Context(Base());
        Assert.Contains("- [1a2b3c4d] מי מאשר את בקשת הביטול?", t);
        Assert.Contains("למה זה חשוב: לא מוגדר גורם מאשר", t);
        Assert.Contains("אם ננחש לא נכון: הבקשה תיתקע", t);
        Assert.Contains("אפשרויות שהוצעו: מנהל הצוות | מנהל הבקרה", t);
        Assert.Contains("מי מכריע: מבקש הדרישה · דחוף", t);
        Assert.Contains("פערים פתוחים (1):", t);
    }

    [Fact]
    public void Keeps_decided_gaps_apart_with_no_reference()
    {
        var t = GapsPrompt.Context(Base([Gap("resolved", "מנהל הבקרה"), Gap("dismissed", "כבר מוגדר", "ffffffff-0000", "סיבה חובה?")]));
        Assert.Contains("(אין — כל הפערים הוכרעו)", t);
        Assert.Contains("- מי מאשר את בקשת הביטול? → הוכרע: מנהל הבקרה", t);
        Assert.Contains("- סיבה חובה? → לא פער: כבר מוגדר", t);
        Assert.DoesNotContain("[1a2b3c4d]", t);
    }

    [Fact]
    public void Checked_decide_later_is_still_open() => Assert.Contains("[1a2b3c4d]", GapsPrompt.Context(Base([Gap("verified")])));

    [Fact]
    public void Says_whether_the_code_can_be_read()
    {
        Assert.Contains("יש לך קריאה בלבד בו", GapsPrompt.Context(Base()));
        Assert.Contains("העותק המקומי לא זמין כרגע", GapsPrompt.Context(Base(repoAvailable: false)));
        Assert.Contains("אין מאגר מקושר", GapsPrompt.Context(Base(noRepo: true)));
    }

    [Fact]
    public void Carries_files_says_which_could_not_be_read_and_cuts_the_long_ones()
    {
        var t = GapsPrompt.Context(Base(files: [("spec.docx", new string('א', 50_000), null), ("scan.pdf", null, "PDF סרוק")]));
        Assert.Contains("--- spec.docx ---", t);
        Assert.Contains("[נקטע כאן]", t);
        Assert.Contains("--- scan.pdf — לא ניתן לקרוא כטקסט (PDF סרוק) ---", t);
    }

    [Fact]
    public void The_transcript_says_who_said_what_and_what_became_of_each_card()
    {
        Assert.Equal("השיחה עד עכשיו: (זו ההודעה הראשונה)", GapsPrompt.Transcript([]));
        var t = GapsPrompt.Transcript(
        [
            new("user", "answer", "מנהל הבקרה מאשר", []),
            new("assistant", "answer", "זה עונה על הפער הראשון", []),
            new("assistant", "proposal", "סגירת פער עם הכרעה", new JsonObject { ["describe"] = "הפער \"מי מאשר\" ייסגר\nעוד שורה", ["status"] = "done" }),
            new("assistant", "refusal", "לא אפשרי מכאן: הפער הזה כבר נסגר", []),
            new("system", "system_note", "סיכום", []),
        ]);
        Assert.Contains("האדם: מנהל הבקרה מאשר", t);
        Assert.Contains("קלוד: זה עונה על הפער הראשון", t);
        Assert.Contains("(כרטיס: סגירת פער עם הכרעה — הפער \"מי מאשר\" ייסגר — אושר ובוצע)", t);
        Assert.Contains("(כרטיס שנדחה: לא אפשרי מכאן: הפער הזה כבר נסגר)", t);
        Assert.DoesNotContain("סיכום", t);
    }

    [Fact]
    public void The_transcript_remembers_only_the_last_turns()
    {
        var t = GapsPrompt.Transcript(Enumerable.Range(0, 50).Select(i => new TranscriptMessage("user", "answer", $"הודעה {i}", [])).ToList());
        Assert.DoesNotContain("הודעה 19\n", t);
        Assert.Contains("הודעה 20", t);
        Assert.Contains("הודעה 49", t);
    }
}

public sealed class ClaudeStreamTests
{
    [Fact]
    public void A_tool_call_reads_as_a_repository_relative_line()
    {
        var line = """{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read","input":{"file_path":"C:\\Users\\me\\.dcc-repos\\3f2a1b7c-0000-4000-8000-000000000000\\src\\app.cs"}}]}}""";
        Assert.Equal("🔧 Read src/app.cs", ClaudeRunner.Describe(line));
        Assert.Equal("🔧 Read src/app.cs", ClaudeRunner.Describe("""{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read","input":{"file_path":"D:/work/repo/src/app.cs"}}]}}""", "D:\\work\\repo"));
    }

    [Fact]
    public void The_final_JSON_answer_is_not_dumped_into_the_transcript_and_the_result_line_says_the_cost()
    {
        Assert.Null(ClaudeRunner.Describe("""{"type":"assistant","message":{"content":[{"type":"text","text":"{\"summary\":\"x\"}"}]}}"""));
        Assert.Equal("✓ Claude סיים (3 צעדים · $0.012)", ClaudeRunner.Describe("""{"type":"result","num_turns":3,"total_cost_usd":0.0123}"""));
    }

    [Fact]
    public void Json_is_pulled_out_of_a_fenced_block_or_prose()
    {
        Assert.Equal(1, ClaudeRunner.ExtractJson("here:\n```json\n{\"a\":1}\n```")["a"]!.GetValue<int>());
        Assert.Equal(2, ClaudeRunner.ExtractJson("answer {\"a\":2} and then some words")["a"]!.GetValue<int>());
        Assert.Throws<ClaudeRunException>(() => ClaudeRunner.ExtractJson("no json at all"));
    }
}
