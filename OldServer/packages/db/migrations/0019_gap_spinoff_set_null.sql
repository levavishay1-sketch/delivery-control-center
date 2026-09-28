-- 0019 — fix an intermittent 500 on deleting a requirement: gap.spun_off_to
-- had no ON DELETE behavior (defaults to NO ACTION/restrict), so deleting
-- a requirement that was born as a gap's spin-off target failed with a raw
-- FK violation. Deleting the spun-off requirement should never be blocked
-- by, or take down, the gap that spawned it — the gap just loses the
-- pointer and keeps its own history.
ALTER TABLE "gap" DROP CONSTRAINT IF EXISTS "gap_spun_off_to_workitem_id_fk";--> statement-breakpoint
ALTER TABLE "gap" ADD CONSTRAINT "gap_spun_off_to_workitem_id_fk"
  FOREIGN KEY ("spun_off_to") REFERENCES "public"."workitem"("id") ON DELETE set null ON UPDATE no action;
