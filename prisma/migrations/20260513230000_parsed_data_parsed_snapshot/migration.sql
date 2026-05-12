-- Full parsed JSON snapshot for client reload (channel_split, report_ui, etc.).
ALTER TABLE "statement"."parsed_data" ADD COLUMN IF NOT EXISTS "parsed_snapshot" JSONB;
