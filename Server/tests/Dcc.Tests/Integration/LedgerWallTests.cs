using Dcc.Domain.Events;
using Dcc.Infrastructure.Ledger;
using Dcc.Infrastructure.Persistence;
using Dcc.Tests.Support;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;

namespace Dcc.Tests.Integration;

/// <summary>
/// The rest of the old server's <c>dev:prove</c> (the event log's half is <see cref="TenantWallTests"/>): the ledger of
/// calls to Claude is behind the wall between clients and never edited — a cost record is money — and a call that belongs
/// to a requirement leaves a thin timeline event that links to its row without repeating the cost (and none when the call
/// is already there through a hook); the conclusions drawn from repeated questions are behind the wall too, for reading
/// and for writing.
/// </summary>
[Collection(DbCollection.Name)]
public sealed class LedgerWallTests(DbFixture fx)
{
    private readonly DccFactory _f = fx.Factory;

    private async Task<T> AsTenantAsync<T>(Guid tenant, Func<DccDbContext, Task<T>> work)
    {
        using var scope = _f.Services.CreateScope();
        return await scope.ServiceProvider.GetRequiredService<ITenantScope>().RunAsync(tenant, work);
    }

    private Task<Guid> UserAsync() => _f.ScalarAsync<Guid>("select id from users order by created_at limit 1");

    private async Task<(Guid A, Guid B, Guid Requirement, Guid Call)> RecordedCallAsync()
    {
        var a = await _f.NewClientAsync();
        var b = await _f.NewClientAsync();
        var wi = await _f.NewRequirementAsync(a);
        using var scope = _f.Services.CreateScope();
        var call = await scope.ServiceProvider.GetRequiredService<ClaudeLedger>().RecordAsync(new ClaudeCallInput
        {
            ClientId = a, UserId = await UserAsync(), WorkitemId = wi, EntityKind = "workitem", EntityId = wi.ToString(),
            Capability = "gap_detection", Trigger = "button", Label = "prove", StartedAt = DateTimeOffset.UtcNow,
            InputTokens = 10, OutputTokens = 5, CostUsd = 0.0123m,
        });
        return (a, b, wi, call);
    }

    private Task<long> CallsSeenBy(Guid tenant, Guid call) =>
        AsTenantAsync(tenant, db => db.Database.SqlQuery<long>($"select count(*) as \"Value\" from claude_call where id = {call}").SingleAsync());

    [Fact]
    public async Task A_tenant_never_reads_another_tenants_call()
    {
        var (a, b, _, call) = await RecordedCallAsync();
        Assert.Equal(1, await CallsSeenBy(a, call));
        Assert.Equal(0, await CallsSeenBy(b, call));
    }

    [Fact]
    public async Task A_call_is_never_edited_or_deleted_not_even_by_its_own_tenant()
    {
        var (a, _, _, call) = await RecordedCallAsync();
        var update = await Assert.ThrowsAnyAsync<Exception>(() => AsTenantAsync(a, db => db.Database.ExecuteSqlAsync($"update claude_call set cost_usd = 0 where id = {call}")));
        Assert.Contains("claude_call is append-only", update.ToString());
        var delete = await Assert.ThrowsAnyAsync<Exception>(() => AsTenantAsync(a, db => db.Database.ExecuteSqlAsync($"delete from claude_call where id = {call}")));
        Assert.Contains("claude_call is append-only", delete.ToString());
        // As the owning role too, where row-level security does not apply.
        var owner = await Assert.ThrowsAsync<PostgresException>(() => _f.ExecAsync("delete from claude_call where id = @id", ("id", call)));
        Assert.Contains("append-only", owner.MessageText);
        Assert.Equal(0.0123m, await _f.ScalarAsync<decimal>("select cost_usd from claude_call where id = @id", ("id", call)));
    }

    [Fact]
    public async Task A_call_on_a_requirement_links_its_timeline_to_the_ledger_row_and_carries_no_cost()
    {
        var (a, _, wi, call) = await RecordedCallAsync();
        using var scope = _f.Services.CreateScope();
        var timeline = await scope.ServiceProvider.GetRequiredService<IEventLogReader>().TimelineAsync(a, wi);
        var thin = Assert.Single(timeline, e => e.Type == "claude.call");
        Assert.Contains(thin.Links.AsArray(), l => l?["rel"]?.GetValue<string>() == "claude_call" && l["ref"]?.GetValue<string>() == call.ToString());
        // Money is counted once — on the ledger row, never again on the timeline.
        Assert.Null(thin.Payload["costUsd"]);
        Assert.False(thin.Payload.AsObject().ContainsKey("costUsd"));
        Assert.Equal("delegated", thin.Actor["kind"]?.GetValue<string>());
    }

    /// <summary>
    /// Writing is walled too: a tenant cannot slip a call tagged as another tenant into the ledger (the check half of the
    /// policy), so one client's costs can never be inflated from another's scope.
    /// </summary>
    [Fact]
    public async Task A_tenant_cannot_write_a_call_for_another_tenant()
    {
        var (a, b, _, _) = await RecordedCallAsync();
        var user = await UserAsync();
        var write = await Assert.ThrowsAnyAsync<Exception>(() => AsTenantAsync(b, db => db.Database.ExecuteSqlAsync($"""
            insert into claude_call (client_id, user_id, capability, trigger, started_at, cost_usd) values ({a}, {user}, 'gap_detection', 'button', now(), 9)
            """)));
        Assert.Contains("row-level security", write.ToString());
        Assert.Equal(0L, await _f.ScalarAsync<long>("select count(*) from claude_call where client_id = @c and cost_usd = 9", ("c", a)));
    }

    /// <summary>A call already on the timeline through another door (a hook's session event) leaves no second entry there.</summary>
    [Fact]
    public async Task A_call_recorded_elsewhere_leaves_no_second_timeline_entry()
    {
        var a = await _f.NewClientAsync();
        var wi = await _f.NewRequirementAsync(a);
        using var scope = _f.Services.CreateScope();
        var call = await scope.ServiceProvider.GetRequiredService<ClaudeLedger>().RecordAsync(new ClaudeCallInput
        {
            ClientId = a, UserId = await UserAsync(), WorkitemId = wi, EntityKind = "workitem", EntityId = wi.ToString(),
            Capability = "interactive_session", Trigger = "session", StartedAt = DateTimeOffset.UtcNow, SourceRef = "session:prove",
        });
        Assert.Equal(1L, await _f.ScalarAsync<long>("select count(*) from claude_call where id = @id", ("id", call)));
        var timeline = await scope.ServiceProvider.GetRequiredService<IEventLogReader>().TimelineAsync(a, wi);
        Assert.DoesNotContain(timeline, e => e.Type == "claude.call");
    }

    [Fact]
    public async Task Conclusions_are_walled_for_reading_and_for_writing()
    {
        var a = await _f.NewClientAsync();
        var b = await _f.NewClientAsync();
        var user = await UserAsync();
        var insight = await AsTenantAsync(a, db => db.Database.SqlQuery<Guid>($"""
            insert into claude_insight (client_id, screen, question_key, sample_question, count, created_by)
            values ({a}, 'requirement', 'מה השלב הבא', 'מה השלב הבא?', 5, {user}) returning id as "Value"
            """).ToListAsync());
        var id = Assert.Single(insight);

        Assert.Equal(1, await AsTenantAsync(a, db => db.Database.SqlQuery<long>($"select count(*) as \"Value\" from claude_insight where id = {id}").SingleAsync()));
        Assert.Equal(0, await AsTenantAsync(b, db => db.Database.SqlQuery<long>($"select count(*) as \"Value\" from claude_insight where id = {id}").SingleAsync()));

        var write = await Assert.ThrowsAnyAsync<Exception>(() => AsTenantAsync(b, db => db.Database.ExecuteSqlAsync($"""
            insert into claude_insight (client_id, screen, question_key, sample_question, created_by) values ({a}, 'task', 'x', 'x', {user})
            """)));
        Assert.Contains("row-level security", write.ToString());
        Assert.Equal(0L, await _f.ScalarAsync<long>("select count(*) from claude_insight where client_id = @c and screen = 'task'", ("c", a)));
    }
}
