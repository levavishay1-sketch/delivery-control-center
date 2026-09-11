import { pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

/**
 * The system's own prompt library. Not tenant data — org-shared config,
 * like `repo` (no RLS): every DCC-driven Claude call should be built from
 * a named, editable template here rather than an inline string buried in
 * TypeScript, so what Claude is actually told is visible and tunable
 * without a code change.
 *
 * `body` holds `{{PLACEHOLDER}}` tokens the calling code fills in — see
 * `renderPrompt` in packages/core/src/prompts.ts.
 */
export const promptTemplate = pgTable(
  "prompt_template",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Stable identifier the code looks the template up by, e.g. "assess.readiness". */
    key: text("key").notNull(),
    /** Display name, shown on the Prompts screen. */
    title: text("title").notNull(),
    /** One-line explanation of when/how this template is used. */
    description: text("description"),
    body: text("body").notNull(),
    /** claude CLI --model value (e.g. "sonnet" | "opus" | "haiku"); null = CLI default. */
    defaultModel: text("default_model"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by"),
  },
  (t) => [unique("prompt_template_key_uq").on(t.key)],
);
