-- Plaintext roll-up columns (no `*_encrypted` names). Drops legacy BYTEA ciphertext columns from 20260513180000.

ALTER TABLE "statement"."parsed_data"
  DROP COLUMN IF EXISTS "total_volume_encrypted",
  DROP COLUMN IF EXISTS "total_fees_encrypted",
  DROP COLUMN IF EXISTS "effective_rate_encrypted",
  DROP COLUMN IF EXISTS "interchange_fees_encrypted",
  DROP COLUMN IF EXISTS "scheme_fees_encrypted",
  DROP COLUMN IF EXISTS "channel_split_encrypted",
  DROP COLUMN IF EXISTS "fee_lines_encrypted";

ALTER TABLE "statement"."parsed_data"
  ADD COLUMN IF NOT EXISTS "total_volume" NUMERIC(24, 6),
  ADD COLUMN IF NOT EXISTS "total_fees" NUMERIC(24, 6),
  ADD COLUMN IF NOT EXISTS "effective_rate" NUMERIC(18, 8),
  ADD COLUMN IF NOT EXISTS "interchange_fees" NUMERIC(24, 6),
  ADD COLUMN IF NOT EXISTS "scheme_fees" NUMERIC(24, 6),
  ADD COLUMN IF NOT EXISTS "channel_split" JSONB,
  ADD COLUMN IF NOT EXISTS "fee_lines" JSONB;
