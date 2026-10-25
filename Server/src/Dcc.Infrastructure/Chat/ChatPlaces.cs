namespace Dcc.Infrastructure.Chat;

/// <summary>A place the chat may take the person to in order to answer them.</summary>
public sealed record PlaceDef(string Key, string Title, string Screen, string Topic, string Answers, Func<ResolvedTopic, string?> Route);

public sealed record Place(PlaceDef Def, string Route);

/// <summary>
/// The map the chat walks (screens/index.ts): every place it may move the person to — a screen that registers its
/// facts, inside the person's own topic. The key comes from here: a key the model invents is refused, never followed.
/// </summary>
public static class ChatPlaces
{
    private static string? PrTab(ResolvedTopic t, string tab)
    {
        var parts = (t.Id ?? "").Split('/');
        return parts.Length == 2 && parts[0].Length > 0 && parts[1].Length > 0 ? $"#/pull-requests/{parts[0]}/{parts[1]}{(tab.Length > 0 ? $"/{tab}" : "")}" : null;
    }

    public static readonly IReadOnlyList<PlaceDef> All =
    [
        new("pr_overview", "סקירה", "pull_request", "pr", "מה חוסם את המיזוג, מה הצעד הבא, כמה הבקשה מאחורי הענף שהיא מיועדת אליו, ומפת הקוד שלה.", t => PrTab(t, "")),
        new("pr_files", "הקבצים שהשתנו", "pull_request", "pr", "כל קובץ שהבקשה משנה, מקובץ לפי נושא, עם כמה שורות נוספו ונמחקו בכל אחד — כאן רואים מה בדיוק השתנה.", t => PrTab(t, "files")),
        new("pr_timeline", "היומן", "pull_request", "pr", "מה קרה לבקשה לאורך הזמן, לפי סדר: קומיטים, סקירות, בדיקות והערות.", t => PrTab(t, "timeline")),
        new("pr_branches", "הענפים", "pull_request", "pr", "כל ענף במאגר ומצבו: מה יש בו שאין בענף הראשי, אם יש לו בקשת מיזוג, ומה מומלץ לעשות איתו.", t => PrTab(t, "branches")),
        new("dashboard", "לוח הבקרה", "dashboard", "app", "כמה דרישות פתוחות וחסומות יש, מה ההתראות האחרונות, וכמה ה-AI עלה החודש מול התקציב.", _ => "#/"),
        new("budgets", "תקציבים", "budgets", "app", "התקציב החודשי של כל לקוח בנפרד, וכמה מתוכו כבר נוצל.", _ => "#/budgets"),
    ];

    /// <summary>Where the chat may go from where it stands: its own topic, never the place it is already on.</summary>
    public static List<Place> For(ResolvedTopic topic, string? at)
    {
        var o = new List<Place>();
        foreach (var def in All)
        {
            if (def.Topic != topic.Kind || def.Key == at) continue;
            if (def.Route(topic) is { } route) o.Add(new Place(def, route));
        }
        return o;
    }

    public static string Render(IReadOnlyList<Place> list) => list.Count == 0 ? "" :
        string.Join("\n", new[] { "מסכים שאפשר לעבור אליהם מכאן (רק אלה):" }.Concat(list.Select(p => $"- {p.Def.Key} — \"{p.Def.Title}\": {p.Def.Answers}")));
}
