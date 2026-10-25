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

        // An agent's actor becomes the person behind it, then the event is validated, then stored (decisions 02, 01).
        services.AddScoped<IEventLogWriter>(sp => new PersonBehindActorWriter(
            new ValidatingEventLogWriter(sp.GetRequiredService<PostgresEventLogWriter>()), sp.GetRequiredService<Persistence.DccDbContext>()));
        return services;
    }
}
