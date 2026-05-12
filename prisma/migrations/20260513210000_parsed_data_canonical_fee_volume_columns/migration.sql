-- Align with canonical parsed JSON keys (README schema): service_fees, other_fees, pos_volume, ecomm_volume.

ALTER TABLE "statement"."parsed_data"
  ADD COLUMN IF NOT EXISTS "service_fees" NUMERIC(24, 6),
  ADD COLUMN IF NOT EXISTS "other_fees" NUMERIC(24, 6),
  ADD COLUMN IF NOT EXISTS "pos_volume" NUMERIC(24, 6),
  ADD COLUMN IF NOT EXISTS "ecomm_volume" NUMERIC(24, 6);
