-- 0045 — the specification, as pieces a task can point at.
--
-- The spec itself does not move: it stays the attachment's extracted text
-- and the `gap` rows. This is the INDEX over it — one row per field, rule,
-- mapping line or closed decision — so a task can say which pieces it
-- implements, the screen can mark them, and a piece nothing implements can
-- be seen. `anchor` is DCC's own stable id, never a line number, so reading
-- the same document again does not move what was already mapped.
CREATE TABLE IF NOT EXISTS "spec_section" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "client_id" uuid NOT NULL REFERENCES "client"("id") ON DELETE cascade,
  "workitem_id" uuid NOT NULL REFERENCES "workitem"("id") ON DELETE cascade,
  "anchor" text NOT NULL,
  "ordinal" integer DEFAULT 0 NOT NULL,
  "kind" text NOT NULL,
  "parent_anchor" text,
  "title" text NOT NULL,
  "body" text DEFAULT '' NOT NULL,
  "attachment_id" uuid REFERENCES "attachment"("id") ON DELETE cascade,
  "gap_id" uuid REFERENCES "gap"("id") ON DELETE cascade,
  "corrected_by_gap_id" uuid REFERENCES "gap"("id") ON DELETE set null,
  "correction" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "spec_section_anchor_idx" ON "spec_section" ("workitem_id", "anchor");
--> statement-breakpoint
ALTER TABLE "spec_section" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "spec_section_tenant_isolation" ON "spec_section" AS PERMISSIVE FOR ALL TO public
  USING ("client_id" = current_setting('app.current_client', true)::uuid)
  WITH CHECK ("client_id" = current_setting('app.current_client', true)::uuid);
--> statement-breakpoint

-- Which pieces of the spec a task implements. `source` keeps a mapping the
-- breakdown decided together with the task apart from one inferred later.
CREATE TABLE IF NOT EXISTS "task_spec_link" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "client_id" uuid NOT NULL REFERENCES "client"("id") ON DELETE cascade,
  "workitem_id" uuid NOT NULL REFERENCES "workitem"("id") ON DELETE cascade,
  "task_id" uuid NOT NULL REFERENCES "task"("id") ON DELETE cascade,
  "anchor" text NOT NULL,
  "source" text DEFAULT 'mapping' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "task_spec_link_idx" ON "task_spec_link" ("task_id", "anchor");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_spec_link_workitem_idx" ON "task_spec_link" ("workitem_id");
--> statement-breakpoint
ALTER TABLE "task_spec_link" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "task_spec_link_tenant_isolation" ON "task_spec_link" AS PERMISSIVE FOR ALL TO public
  USING ("client_id" = current_setting('app.current_client', true)::uuid)
  WITH CHECK ("client_id" = current_setting('app.current_client', true)::uuid);
