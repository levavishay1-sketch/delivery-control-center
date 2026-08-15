-- Follow-up to 20260815025847_slice2_data_models: stageSequence has now
-- been backfilled on every existing row, so it can be made required.
ALTER TABLE "Pipeline" ALTER COLUMN "stageSequence" SET NOT NULL;
