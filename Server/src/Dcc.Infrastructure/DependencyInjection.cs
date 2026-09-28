using Dcc.Application.Auth;
using Dcc.Application.UserDirectory;
using Dcc.Infrastructure.Ado;
using Dcc.Infrastructure.Audit;
using Dcc.Infrastructure.Auth;
using Dcc.Infrastructure.UserDirectory;
using Dcc.Infrastructure.Entra;
using Dcc.Infrastructure.Clients;
using Dcc.Infrastructure.Events;
using Dcc.Infrastructure.Glossary;
using Dcc.Infrastructure.Policy;
using Dcc.Infrastructure.Prompts;
using Dcc.Infrastructure.Persistence;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace Dcc.Infrastructure;

public static class DependencyInjection
{
    public static IServiceCollection AddInfrastructure(this IServiceCollection services, IConfiguration config, JwtSigningKey signingKey)
    {
        var connectionString = config.GetConnectionString("Dcc")
            ?? throw new InvalidOperationException("ConnectionStrings:Dcc is not set. Run `dotnet run -- db-bootstrap` once.");

        services.AddDbContext<DccDbContext>(o => o.UseNpgsql(connectionString).UseSnakeCaseNamingConvention());
        services.AddScoped<ITenantScope, TenantScope>();
        services.AddMemoryCache();

        services.Configure<AuthOptions>(config.GetSection(AuthOptions.Section));
        services.Configure<BootstrapOptions>(config.GetSection(BootstrapOptions.Section));
        services.Configure<AgentOptions>(config.GetSection(AgentOptions.Section));
        services.Configure<EntraOptions>(config.GetSection(EntraOptions.Section));

        services.AddEventLog();
        services.AddAuditLog();

        services.AddSingleton(signingKey);
        services.AddSingleton<IPasswordHasher<UserRow>, PasswordHasher<UserRow>>();
        services.AddScoped<IPermissionService, PermissionService>();
        services.AddScoped<PermissionService>(sp => (PermissionService)sp.GetRequiredService<IPermissionService>());
        services.AddScoped<IPermissionVersionBumper, PermissionVersionBumper>();
        services.AddScoped<TokenIssuer>();
        services.AddScoped<IAuthService, AuthService>();
        services.AddScoped<CatalogSeeder>();
        services.AddScoped<DirectoryService>();

        // Clients, repositories, Azure DevOps connections (phase 4.1)
        services.AddHttpClient(AdoClient.HttpClientName, c => c.Timeout = TimeSpan.FromSeconds(20));
        services.AddScoped<AdoClient>();
        services.AddScoped<ClientService>();
        services.AddScoped<ConnectionService>();

        // What the organisation shares: the prompt library, the model policy, the "i" glossary
        services.Configure<ModelPolicyOptions>(config.GetSection(ModelPolicyOptions.Section));
        services.Configure<GlossaryOptions>(config.GetSection(GlossaryOptions.Section));
        services.AddSingleton<ModelPolicyStore>();
        services.AddSingleton<GlossaryService>();
        services.AddScoped<PromptService>();
        services.AddScoped<PolicyService>();
        services.AddScoped<InternalClient>();

        services.AddSingleton<GraphClientFactory>();
        services.AddScoped<IGuestInvitationService, GraphGuestInvitationService>();
        services.AddScoped<EntraIdentityLinker>();
        services.AddHostedService<EntraDirectorySync>();

        return services;
    }
}
