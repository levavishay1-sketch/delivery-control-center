using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Dcc.Mcp;

/// <summary>
/// Started by an MCP client (Claude Code) as a child process — for example
/// <c>claude mcp add dcc --env DCC_API_TOKEN=dcc_pat_… -- dotnet run --project &lt;the DCC checkout&gt;/Server/src/Dcc.Mcp</c>
/// (an absolute path: the client starts it in whatever folder it runs in).
/// stdin and stdout carry the protocol's JSON-RPC; it exits when the client closes stdin.
/// </summary>
internal static class Program
{
    private static async Task Main(string[] args)
    {
        var builder = Host.CreateApplicationBuilder(args);
        // stdout is the JSON-RPC channel: one log line written there breaks the client's connection, so every level goes to stderr.
        builder.Logging.AddConsole(o => o.LogToStandardErrorThreshold = LogLevel.Trace);

        var settings = DccApiSettings.FromEnvironment();
        builder.Services.AddDccMcpServer(new DccApi(settings.CreateHttpClient())).WithStdioServerTransport();

        using var host = builder.Build();
        var log = host.Services.GetRequiredService<ILoggerFactory>().CreateLogger("Dcc.Mcp");
        if (settings.Token is null)
            log.LogWarning("{Variable} is not set, so DCC will refuse every tool. Ask an admin for a token (POST /tokens) and set it in the MCP client's configuration.",
                DccApiSettings.TokenVariable);
        log.LogInformation("DCC MCP server for {Url}", settings.BaseUrl);
        await host.RunAsync();
    }
}
