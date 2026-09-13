CREATE TABLE IF NOT EXISTS "bug_task_link" (
	"client_id" uuid NOT NULL,
	"bug_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bug_task_link_bug_id_task_id_pk" PRIMARY KEY("bug_id","task_id")
);--> statement-breakpoint
ALTER TABLE "bug_task_link" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bug_task_link" ADD CONSTRAINT "bug_task_link_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bug_task_link" ADD CONSTRAINT "bug_task_link_bug_id_workitem_id_fk" FOREIGN KEY ("bug_id") REFERENCES "public"."workitem"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bug_task_link" ADD CONSTRAINT "bug_task_link_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "bug_task_link_tenant_isolation" ON "bug_task_link" AS PERMISSIVE FOR ALL TO public USING (client_id = current_setting('app.current_client', true)::uuid) WITH CHECK (client_id = current_setting('app.current_client', true)::uuid);
