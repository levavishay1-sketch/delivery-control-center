using Microsoft.Extensions.DependencyInjection;
using ModelContextProtocol.Protocol;

namespace Dcc.Mcp;

/// <summary>
/// The MCP server, short of its transport: stdio when an MCP client starts this process (<see cref="Program"/>),
/// in-memory streams in the tests — the same tools either way.
/// </summary>
public static class DccMcpServer
{
    /// <summary>The name and version MCP clients see; a client that registered "dcc" keeps finding it.</summary>
    public static readonly Implementation Info = new() { Name = "dcc", Version = "0.1.0" };

    public static IMcpServerBuilder AddDccMcpServer(this IServiceCollection services, DccApi api)
    {
        services.AddSingleton(api);
        return services.AddMcpServer(o => o.ServerInfo = Info)
            .WithTools<DccTools>()
            .WithRequestFilters(f => f.AddCallToolFilter(next => (request, ct) =>
                DccTools.RefuseMalformedId(request.Params) is { } refusal ? ValueTask.FromResult(refusal) : next(request, ct)));
    }
}
