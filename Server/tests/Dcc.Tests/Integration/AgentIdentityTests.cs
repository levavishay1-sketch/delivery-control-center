using System.Net.Http.Json;
using System.Text.Json;
using Dcc.Tests.Support;

namespace Dcc.Tests.Integration;

/// <summary>
/// Decision 02 at the event log's door: whatever route an agent's API token writes through — a skill's gap, a blocker,
/// a person's own kind of write — the timeline names the person behind the agent, never the agent's own row.
/// </summary>
[Collection(DbCollection.Name)]
public sealed class AgentIdentityTests(DbFixture fx)
{
    private readonly DccFactory _f = fx.Factory;

    private static async Task<JsonElement> Ok(HttpResponseMessage res)
    {
        var body = await res.Content.ReadFromJsonAsync<JsonElement>();
        if (!res.IsSuccessStatusCode) throw new InvalidOperationException($"{(int)res.StatusCode}: {body}");
        return body;
    }

    [Fact]
    public async Task A_skill_write_made_with_a_delegated_agents_token_is_recorded_as_its_owner_with_the_agent_named()
    {
        var admin = _f.Client(await _f.AdminTokenAsync());
        var clientId = await _f.NewClientAsync();
        var reqId = (await Ok(await admin.PostAsJsonAsync("/workitems", new { clientId, title = "Coupons" }))).GetProperty("id").GetGuid();
        var (ownerId, _, _) = await _f.NewUserAsync();
        await _f.AssignAsync("user", ownerId, "contributor", "client", clientId);
        var agent = (await Ok(await admin.PostAsJsonAsync("/agents", new { displayName = "skill-bot", ownerUserId = ownerId }))).GetProperty("id").GetGuid();
        await _f.AssignAsync("user", agent, "contributor", "client", clientId);
        var bot = _f.Client((await Ok(await admin.PostAsJsonAsync("/tokens", new { name = "skills", forAgentId = agent }))).GetProperty("secret").GetString()!);

        await Ok(await bot.PostAsJsonAsync($"/workitems/{reqId}/gaps", new { description = "Which currency?", blocking = true, confidence = 0.8, mode = "delegated" }));
        await Ok(await bot.PostAsJsonAsync($"/workitems/{reqId}/blockers", new { question = "May coupons stack?", questionType = "unclear_requirement" }));

        var events = (await Ok(await admin.GetAsync($"/workitems/{reqId}/timeline"))).GetProperty("events").EnumerateArray().ToList();
        foreach (var type in new[] { "gap.proposed", "blocker.raised" })
        {
            var actor = events.Single(e => e.GetProperty("type").GetString() == type).GetProperty("actor");
            Assert.Equal("delegated", actor.GetProperty("kind").GetString());
            Assert.Equal(ownerId, actor.GetProperty("userId").GetGuid());
            Assert.Equal(agent, actor.GetProperty("agentId").GetGuid());
        }
        // What triggered the write is kept; the agent is named by its id.
        Assert.Equal("skill:gap-report", events.Single(e => e.GetProperty("type").GetString() == "gap.proposed").GetProperty("actor").GetProperty("triggeredBy").GetString());
    }
}
