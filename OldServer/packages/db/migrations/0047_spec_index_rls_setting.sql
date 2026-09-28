-- 0047 — 0045 wrote its two policies against `app.client_id`; every other
-- table in this database reads the tenant from `app.current_client`, which
-- is what `withTenant` actually sets. The policies therefore matched nothing
-- and refused every insert. Replace them with the one the rest of the
-- schema uses. (0045 is corrected in place for a database created from
-- scratch; this migration is what fixes one that already ran it.)
DROP POLICY IF EXISTS "spec_section_tenant_isolation" ON "spec_section";
--> statement-breakpoint
CREATE POLICY "spec_section_tenant_isolation" ON "spec_section" AS PERMISSIVE FOR ALL TO public
  USING ("client_id" = current_setting('app.current_client', true)::uuid)
  WITH CHECK ("client_id" = current_setting('app.current_client', true)::uuid);
--> statement-breakpoint
DROP POLICY IF EXISTS "task_spec_link_tenant_isolation" ON "task_spec_link";
--> statement-breakpoint
CREATE POLICY "task_spec_link_tenant_isolation" ON "task_spec_link" AS PERMISSIVE FOR ALL TO public
  USING ("client_id" = current_setting('app.current_client', true)::uuid)
  WITH CHECK ("client_id" = current_setting('app.current_client', true)::uuid);
