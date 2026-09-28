import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./migrations",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://dcc:dcc@localhost:5432/dcc",
  },
  // RLS policies are declared in the schema (pgPolicy) and emitted into
  // migrations. The append-only triggers live in sql/guards.sql and are
  // applied by `npm run guards` after `migrate` — drizzle-kit does not
  // manage triggers.
  verbose: true,
  strict: true,
});
