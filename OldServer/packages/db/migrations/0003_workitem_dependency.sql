CREATE TABLE "workitem_dependency" (
	"client_id" uuid NOT NULL,
	"workitem_id" uuid NOT NULL,
	"depends_on_workitem_id" uuid NOT NULL,
	"kind" text DEFAULT 'predecessor' NOT NULL,
	"reason" text,
	"origin_gap_id" uuid,
	"ado_link_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workitem_dependency_workitem_id_depends_on_workitem_id_pk" PRIMARY KEY("workitem_id","depends_on_workitem_id")
);
--> statement-breakpoint
ALTER TABLE "workitem_dependency" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "workitem_dependency" ADD CONSTRAINT "workitem_dependency_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workitem_dependency" ADD CONSTRAINT "workitem_dependency_workitem_id_workitem_id_fk" FOREIGN KEY ("workitem_id") REFERENCES "public"."workitem"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workitem_dependency" ADD CONSTRAINT "workitem_dependency_depends_on_workitem_id_workitem_id_fk" FOREIGN KEY ("depends_on_workitem_id") REFERENCES "public"."workitem"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workitem_dependency" ADD CONSTRAINT "workitem_dependency_origin_gap_id_gap_id_fk" FOREIGN KEY ("origin_gap_id") REFERENCES "public"."gap"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workitem_dependency_from_idx" ON "workitem_dependency" USING btree ("workitem_id");--> statement-breakpoint
CREATE INDEX "workitem_dependency_to_idx" ON "workitem_dependency" USING btree ("depends_on_workitem_id");--> statement-breakpoint
CREATE POLICY "workitem_dependency_tenant_isolation" ON "workitem_dependency" AS PERMISSIVE FOR ALL TO public USING (client_id = current_setting('app.current_client', true)::uuid) WITH CHECK (client_id = current_setting('app.current_client', true)::uuid);