using Dcc.Api.Auth;
using Dcc.Api.Controllers;
using Dcc.Api.Infrastructure;
using Dcc.Api.Sockets;
using Dcc.Infrastructure;
using Dcc.Infrastructure.Auth;
using Dcc.Infrastructure.Entra;
using Dcc.Infrastructure.Persistence;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authorization;
using Microsoft.Identity.Web;

var builder = WebApplication.CreateBuilder(args);

// Server/.local holds what never goes into git: the database password, the
// token-signing key, the first admin's one-time password.
var localDir = Path.GetFullPath(Path.Combine(builder.Environment.ContentRootPath, "..", "..", ".local"));
var dbDir = Path.GetFullPath(Path.Combine(builder.Environment.ContentRootPath, "..", "..", "db"));
builder.Configuration.AddJsonFile(Path.Combine(localDir, "appsettings.local.json"), optional: true, reloadOnChange: false);
builder.Configuration.AddEnvironmentVariables();

// ── one-time commands ─────────────────────────────────────────────────
if (args.Contains("db-bootstrap"))
{
    await DatabaseBootstrapper.RunAsync(DatabaseBootstrapper.SuperuserConnectionFromFile(Path.Combine(localDir, "postgres-superuser.txt")), localDir);
    Console.WriteLine("Database ready: roles dcc_owner / dcc_app and database dcc. Connection saved to Server/.local/appsettings.local.json.");
    return;
}

string Resolve(string path) => Path.IsPathRooted(path) ? path : Path.GetFullPath(Path.Combine(builder.Environment.ContentRootPath, path));

var authOptions = builder.Configuration.GetSection(AuthOptions.Section).Get<AuthOptions>() ?? new AuthOptions();
var signingKey = JwtSigningKey.Load(Resolve(authOptions.SigningKeyPath), authOptions.MinRsaKeyBits, createIfMissing: builder.Environment.IsDevelopment());

builder.Services.AddInfrastructure(builder.Configuration, signingKey);
builder.Services.PostConfigure<BootstrapOptions>(o => o.InitialAdminPasswordFile = Resolve(o.InitialAdminPasswordFile));
builder.Services.PostConfigure<Dcc.Infrastructure.Policy.ModelPolicyOptions>(o => o.Path = Resolve(o.Path));
builder.Services.PostConfigure<Dcc.Infrastructure.Glossary.GlossaryOptions>(o => o.Path = Resolve(o.Path));
builder.Services.Configure<SocketOptions>(builder.Configuration.GetSection("Auth:WebSocket"));

// ── authentication: a JWT from us, or an API token (dcc_pat_…) ─────────
const string SmartScheme = "dcc";
var authn = builder.Services.AddAuthentication(o =>
    {
        o.DefaultScheme = SmartScheme;
        o.DefaultChallengeScheme = SmartScheme;
    })
    .AddPolicyScheme(SmartScheme, "JWT or API token", o =>
        o.ForwardDefaultSelector = ctx =>
            ctx.Request.Headers.Authorization.ToString().StartsWith("Bearer " + Secrets.ApiTokenPrefix, StringComparison.Ordinal)
                ? ApiTokenAuthenticationHandler.SchemeName
                : JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(o =>
    {
        o.MapInboundClaims = false;
        o.TokenValidationParameters = TokenIssuer.ValidationParameters(signingKey, authOptions);
        o.Events = AccessTokenChecks.Events();
    })
    .AddScheme<AuthenticationSchemeOptions, ApiTokenAuthenticationHandler>(ApiTokenAuthenticationHandler.SchemeName, null);

// Entra ID (and B2B guests): only once the application is registered.
var entra = builder.Configuration.GetSection(EntraOptions.Section).Get<EntraOptions>() ?? new EntraOptions();
if (entra.IsConfigured)
{
    authn.AddMicrosoftIdentityWebApp(o =>
        {
            o.Instance = entra.Instance;
            o.TenantId = entra.TenantId;
            o.ClientId = entra.ClientId;
            o.ClientSecret = entra.ClientSecret;
            o.CallbackPath = entra.CallbackPath;
        },
        cookie => cookie.ExpireTimeSpan = TimeSpan.FromMinutes(5),
        openIdConnectScheme: EntraAuthController.OidcScheme,
        cookieScheme: EntraAuthController.CookieScheme);
}

builder.Services.AddAuthorization(o =>
{
    // Every endpoint needs a signed-in user unless it says [AllowAnonymous].
    o.FallbackPolicy = new AuthorizationPolicyBuilder().RequireAuthenticatedUser().Build();
});

builder.Services.AddControllers()
    .ConfigureApiBehaviorOptions(o =>
        // A body that does not bind answers in the same { error, message } shape as every other refusal.
        o.InvalidModelStateResponseFactory = ctx => new Microsoft.AspNetCore.Mvc.BadRequestObjectResult(new
        {
            error = "bad_request",
            message = string.Join("; ", ctx.ModelState.Where(e => e.Value?.Errors.Count > 0)
                .Select(e => $"{e.Key}: {e.Value!.Errors[0].ErrorMessage}")),
        }));
builder.Services.AddExceptionHandler<DccExceptionHandler>();
builder.Services.AddProblemDetails();

var app = builder.Build();

// ── database: migrations, then the catalog and the first admin ────────
if (builder.Configuration.GetValue("Database:MigrateOnStartup", true) || args.Contains("db-migrate"))
{
    var connection = builder.Configuration.GetConnectionString("Dcc")!;
    await new DatabaseMigrator(connection, dbDir, app.Logger).MigrateAsync();
    using var scope = app.Services.CreateScope();
    await scope.ServiceProvider.GetRequiredService<CatalogSeeder>().SeedAsync();
    if (args.Contains("db-migrate")) return;
}

app.UseExceptionHandler();
app.UseWebSockets(new WebSocketOptions { KeepAliveInterval = TimeSpan.FromSeconds(30) });
app.UseAuthentication();
app.UseMiddleware<PasswordChangeGate>();
app.UseAuthorization();

app.MapControllers();

// A signed-in socket with nothing else to do yet: it proves the handshake and
// carries server pushes later. Answers {"type":"ping"} with {"type":"pong"}.
app.Map("/ws/session", async (HttpContext http) =>
{
    if (!http.WebSockets.IsWebSocketRequest) { http.Response.StatusCode = 400; return; }
    await AuthenticatedSocket.RunAsync(http,
        authorize: (_, _) => Task.FromResult(true),
        onMessage: async (socket, m) =>
        {
            if (m.TryGetProperty("type", out var t) && t.GetString() == "ping") await socket.SendAsync(new { type = "pong" }, http.RequestAborted);
        });
}).AllowAnonymous();

app.Run();

/// <summary>Visible to the integration tests (WebApplicationFactory&lt;Program&gt;).</summary>
public partial class Program;
