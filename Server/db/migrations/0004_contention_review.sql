CREATE TABLE "review" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"workitem_id" uuid NOT NULL,
	"pr_ref" text,
	"verdict" text NOT NULL,
	"findings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"overlap_focus" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "review" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "workitem_file_touch" (
	"client_id" uuid NOT NULL,
	"workitem_id" uuid NOT NULL,
	"repo_id" uuid NOT NULL,
	"path" text NOT NULL,
	"branch" text,
	"kind" text DEFAULT 'declared' NOT NULL,
	"last_touched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"released_at" timestamp with time zone,
	CONSTRAINT "workitem_file_touch_workitem_id_repo_id_path_pk" PRIMARY KEY("workitem_id","repo_id","path")
);
--> statement-breakpoint
ALTER TABLE "workitem_file_touch" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "review" ADD CONSTRAINT "review_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review" ADD CONSTRAINT "review_workitem_id_workitem_id_fk" FOREIGN KEY ("workitem_id") REFERENCES "public"."workitem"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review" ADD CONSTRAINT "review_by_user_id_users_id_fk" FOREIGN KEY ("by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workitem_file_touch" ADD CONSTRAINT "workitem_file_touch_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workitem_file_touch" ADD CONSTRAINT "workitem_file_touch_workitem_id_workitem_id_fk" FOREIGN KEY ("workitem_id") REFERENCES "public"."workitem"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workitem_file_touch" ADD CONSTRAINT "workitem_file_touch_repo_id_repo_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repo"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "review_workitem_idx" ON "review" USING btree ("workitem_id");--> statement-breakpoint
CREATE INDEX "wft_repo_path_idx" ON "workitem_file_touch" USING btree ("repo_id","path") WHERE released_at is null;--> statement-breakpoint
CREATE POLICY "review_tenant_isolation" ON "review" AS PERMISSIVE FOR ALL TO public USING (client_id = current_setting('app.current_client', true)::uuid) WITH CHECK (client_id = current_setting('app.current_client', true)::uuid);--> statement-breakpoint
CREATE POLICY "workitem_file_touch_tenant_isolation" ON "workitem_file_touch" AS PERMISSIVE FOR ALL TO public USING (client_id = current_setting('app.current_client', true)::uuid) WITH CHECK (client_id = current_setting('app.current_client', true)::uuid);