-- 0010 — file attachments on requirements. Bytes live in Azure DevOps
-- (TFS is the mirror); DCC keeps name + url + a link to the work item.
CREATE TABLE IF NOT EXISTS "attachment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"workitem_id" uuid NOT NULL,
	"name" text NOT NULL,
	"ado_attachment_id" text,
	"ado_url" text,
	"size_bytes" integer,
	"source" text DEFAULT 'dcc' NOT NULL,
	"added_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attachment" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_workitem_id_workitem_id_fk" FOREIGN KEY ("workitem_id") REFERENCES "public"."workitem"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "attachment_workitem_idx" ON "attachment" USING btree ("workitem_id");--> statement-breakpoint
CREATE POLICY "attachment_tenant_isolation" ON "attachment" AS PERMISSIVE FOR ALL TO public USING (client_id = current_setting('app.current_client', true)::uuid) WITH CHECK (client_id = current_setting('app.current_client', true)::uuid);
