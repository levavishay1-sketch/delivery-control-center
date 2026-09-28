-- F-6 (architecture review): enforce "same client all the way down".
-- Hand-reordered: the UNIQUE (id, client_id) constraints must exist
-- before the composite FKs that reference them (drizzle-kit emitted them
-- last).
ALTER TABLE "project" ADD CONSTRAINT "project_id_client_uq" UNIQUE("id","client_id");--> statement-breakpoint
ALTER TABLE "workitem" ADD CONSTRAINT "workitem_id_client_uq" UNIQUE("id","client_id");--> statement-breakpoint
ALTER TABLE "workitem" ADD CONSTRAINT "workitem_project_client_fk" FOREIGN KEY ("project_id","client_id") REFERENCES "public"."project"("id","client_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blocker" ADD CONSTRAINT "blocker_workitem_client_fk" FOREIGN KEY ("workitem_id","client_id") REFERENCES "public"."workitem"("id","client_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gap" ADD CONSTRAINT "gap_workitem_client_fk" FOREIGN KEY ("workitem_id","client_id") REFERENCES "public"."workitem"("id","client_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_workitem_client_fk" FOREIGN KEY ("workitem_id","client_id") REFERENCES "public"."workitem"("id","client_id") ON DELETE no action ON UPDATE no action;
