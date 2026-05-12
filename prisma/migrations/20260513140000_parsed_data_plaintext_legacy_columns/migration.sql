-- Restore legacy `parsed_data` column names for roll-ups. Values are plaintext NUMERIC/JSONB (not BYTEA ciphertext).
-- Replaces the interim `parsed_payload`-only shape from 20260512180000.

ALTER TABLE "statement"."parsed_data" DROP COLUMN IF EXISTS "parsed_payload";

ALTER TABLE "statement"."parsed_data"
  ADD COLUMN IF NOT EXISTS "encryption_key_id" UUID,
  ADD COLUMN IF NOT EXISTS "total_volume_encrypted" NUMERIC(24, 6),
  ADD COLUMN IF NOT EXISTS "total_fees_encrypted" NUMERIC(24, 6),
  ADD COLUMN IF NOT EXISTS "effective_rate_encrypted" NUMERIC(18, 8),
  ADD COLUMN IF NOT EXISTS "interchange_fees_encrypted" NUMERIC(24, 6),
  ADD COLUMN IF NOT EXISTS "scheme_fees_encrypted" NUMERIC(24, 6),
  ADD COLUMN IF NOT EXISTS "channel_split_encrypted" JSONB,
  ADD COLUMN IF NOT EXISTS "fee_lines_encrypted" JSONB;

ALTER TABLE "statement"."parsed_data" DROP CONSTRAINT IF EXISTS "parsed_data_encryption_key_id_fkey";

ALTER TABLE "statement"."parsed_data"
  ADD CONSTRAINT "parsed_data_encryption_key_id_fkey"
  FOREIGN KEY ("encryption_key_id") REFERENCES "identity"."encryption_key_registry"("encryption_key_id") ON DELETE RESTRICT ON UPDATE CASCADE;
