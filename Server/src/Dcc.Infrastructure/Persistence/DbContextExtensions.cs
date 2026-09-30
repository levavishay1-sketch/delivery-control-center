using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Storage;
using Npgsql;

namespace Dcc.Infrastructure.Persistence;

/// <summary>Raw Npgsql access on the context's own connection and transaction — so RLS and the tenant scope still apply.</summary>
public static class DbContextExtensions
{
    public static System.Data.Common.DbConnection GetDbConnectionSafe(this DatabaseFacade database)
    {
        var conn = database.GetDbConnection();
        if (conn.State != System.Data.ConnectionState.Open) database.OpenConnection();
        return conn;
    }

    public static NpgsqlTransaction? CurrentNpgsqlTransaction(this DccDbContext db) =>
        (NpgsqlTransaction?)db.Database.CurrentTransaction?.GetDbTransaction();
}
