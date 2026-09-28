using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Dcc.Tests.Support;

namespace Dcc.Tests.Integration;

/// <summary>Sign-in, the password rules, refresh rotation and what makes a token unusable.</summary>
[Collection(DbCollection.Name)]
public sealed class AuthTests(DbFixture fx)
{
    private readonly DccFactory _f = fx.Factory;

    private static async Task<string> ErrorOf(HttpResponseMessage res) =>
        (await res.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("error").GetString()!;

    [Fact]
    public async Task Every_endpoint_needs_a_signed_in_user()
    {
        var res = await _f.Client().GetAsync("/users");
        Assert.Equal(HttpStatusCode.Unauthorized, res.StatusCode);
    }

    [Fact]
    public async Task A_wrong_password_and_an_unknown_email_give_the_same_answer()
    {
        var unknown = await _f.LoginRawAsync("nobody@test.local", "whatever-password");
        var (id, _, _) = await _f.NewUserAsync();
        var email = await _f.ScalarAsync<string>("select email from users where id = @id", ("id", id));
        var wrong = await _f.LoginRawAsync(email, "not-the-password");
        Assert.Equal(HttpStatusCode.Unauthorized, unknown.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, wrong.StatusCode);
        Assert.Equal("invalid_credentials", await ErrorOf(unknown));
        Assert.Equal("invalid_credentials", await ErrorOf(wrong));
    }

    [Fact]
    public async Task Five_wrong_passwords_lock_the_account()
    {
        var (id, _, password) = await _f.NewUserAsync();
        var email = await _f.ScalarAsync<string>("select email from users where id = @id", ("id", id));
        for (var i = 0; i < 5; i++) await _f.LoginRawAsync(email, "wrong-" + i);
        var res = await _f.LoginRawAsync(email, password);
        Assert.Equal(HttpStatusCode.Unauthorized, res.StatusCode);
        Assert.Equal("account_locked", await ErrorOf(res));
    }

    [Fact]
    public async Task The_password_is_stored_only_as_a_salted_hash()
    {
        var (id, _, password) = await _f.NewUserAsync();
        var hash = await _f.ScalarAsync<string>("select password_hash from local_credential where user_id = @id", ("id", id));
        Assert.DoesNotContain(password, hash);
        Assert.Equal(1, Convert.FromBase64String(hash)[0]); // ASP.NET Core Identity v3 format: PBKDF2 with a random salt
    }

    [Fact]
    public async Task Until_the_first_password_is_changed_nothing_else_is_open()
    {
        var admin = await _f.AdminTokenAsync();
        var email = $"new{Guid.NewGuid():N}@test.local";
        await _f.Client(admin).PostAsJsonAsync("/users", new { email, displayName = "New", password = "initial-password-1" });
        var first = await _f.LoginAsync(email, "initial-password-1");
        Assert.True(first.Body.GetProperty("mustChangePassword").GetBoolean());

        var blocked = await _f.Client(first.AccessToken).GetAsync("/users");
        Assert.Equal(HttpStatusCode.Forbidden, blocked.StatusCode);
        Assert.Equal("password_change_required", await ErrorOf(blocked));
        Assert.Equal(HttpStatusCode.OK, (await _f.Client(first.AccessToken).GetAsync("/auth/me")).StatusCode);

        var weak = await _f.Client(first.AccessToken).PostAsJsonAsync("/auth/change-password", new { currentPassword = "initial-password-1", newPassword = "short" });
        Assert.Equal("weak_password", await ErrorOf(weak));
    }

    [Fact]
    public async Task A_tampered_token_is_refused()
    {
        var (_, token, _) = await _f.NewUserAsync();
        var parts = token.Split('.');
        var payload = Encoding.UTF8.GetString(Convert.FromBase64String(Pad(parts[1].Replace('-', '+').Replace('_', '/'))));
        var forged = payload.Replace("\"kind\":\"person\"", "\"kind\":\"admin\"");
        var forgedToken = $"{parts[0]}.{Convert.ToBase64String(Encoding.UTF8.GetBytes(forged)).TrimEnd('=').Replace('+', '-').Replace('/', '_')}.{parts[2]}";

        Assert.Equal(HttpStatusCode.OK, (await _f.Client(token).GetAsync("/auth/me")).StatusCode);
        var res = await _f.Client(forgedToken).GetAsync("/auth/me");
        Assert.Equal(HttpStatusCode.Unauthorized, res.StatusCode);
        Assert.Equal("invalid_token", await ErrorOf(res));
    }

    [Fact]
    public async Task A_token_issued_before_a_permission_change_is_stale()
    {
        var (id, token, _) = await _f.NewUserAsync();
        await _f.AssignAsync("user", id, "reader", "global", null);
        var res = await _f.Client(token).GetAsync("/auth/me");
        Assert.Equal(HttpStatusCode.Unauthorized, res.StatusCode);
        Assert.Equal("token_stale", await ErrorOf(res));
    }

    [Fact]
    public async Task Refresh_rotates_and_a_reused_refresh_token_ends_the_session()
    {
        var (id, _, password) = await _f.NewUserAsync();
        var email = await _f.ScalarAsync<string>("select email from users where id = @id", ("id", id));
        var s = await _f.LoginAsync(email, password);

        var first = await Refresh(s.RefreshCookie);
        Assert.Equal(HttpStatusCode.OK, first.StatusCode);
        var rotated = DccFactory.RefreshCookieOf(first);
        Assert.NotEqual(s.RefreshCookie, rotated);

        // Past the tab-race grace window, presenting the old token again is treated as theft.
        await _f.ExecAsync("update user_token set revoked_at = revoked_at - interval '1 minute' where user_id = @id and replaced_by is not null", ("id", id));
        var reuse = await Refresh(s.RefreshCookie);
        Assert.Equal(HttpStatusCode.Unauthorized, reuse.StatusCode);

        var after = await Refresh(rotated);
        Assert.Equal(HttpStatusCode.Unauthorized, after.StatusCode); // the whole chain was revoked
    }

    [Fact]
    public async Task Disabling_a_user_ends_their_access_at_once()
    {
        var (id, token, _) = await _f.NewUserAsync();
        var admin = await _f.AdminTokenAsync();
        var res = await _f.Client(admin).PatchAsJsonAsync($"/users/{id}", new { disabled = true });
        res.EnsureSuccessStatusCode();
        var me = await _f.Client(token).GetAsync("/auth/me");
        Assert.Equal(HttpStatusCode.Unauthorized, me.StatusCode);
    }

    [Fact]
    public async Task Signing_out_revokes_the_refresh_token()
    {
        var (id, _, password) = await _f.NewUserAsync();
        var email = await _f.ScalarAsync<string>("select email from users where id = @id", ("id", id));
        var s = await _f.LoginAsync(email, password);
        var logout = new HttpRequestMessage(HttpMethod.Post, "/auth/logout");
        logout.Headers.Add("Cookie", s.RefreshCookie);
        await _f.Client().SendAsync(logout);
        Assert.Equal(HttpStatusCode.Unauthorized, (await Refresh(s.RefreshCookie)).StatusCode);
    }

    private Task<HttpResponseMessage> Refresh(string cookie)
    {
        var req = new HttpRequestMessage(HttpMethod.Post, "/auth/refresh");
        req.Headers.Add("Cookie", cookie);
        return _f.Client().SendAsync(req);
    }

    private static string Pad(string s) => s.PadRight(s.Length + (4 - s.Length % 4) % 4, '=');
}
