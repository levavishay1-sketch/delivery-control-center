using Dcc.Domain.Events;
using Microsoft.Extensions.DependencyInjection;

namespace Dcc.Infrastructure.Events;

public static class EventLogRegistration
{
    /// <summary>
    /// THE one place that decides where the event log is kept.
    /// To keep it somewhere else, write a class that implements
    /// <see cref="IEventLogWriter"/> (and <see cref="IEventLogReader"/>) and change the
    /// two <c>Store</c> lines below — nothing else in the code base changes, and
    /// validation stays wrapped around whichever store is chosen.
    /// (Moving the log off Postgres touches architecture decision 01 and needs a
    /// review at the time; the seam is ready for it.)
    /// </summary>
    public static IServiceCollection AddEventLog(this IServiceCollection services)
    {
        services.AddScoped<PostgresEventLogWriter>();      // Store: writer
        services.AddScoped<IEventLogReader, PostgresEventLogReader>(); // Store: reader

        services.AddScoped<IEventLogWriter>(sp => new ValidatingEventLogWriter(sp.GetRequiredService<PostgresEventLogWriter>()));
        return services;
    }
}
