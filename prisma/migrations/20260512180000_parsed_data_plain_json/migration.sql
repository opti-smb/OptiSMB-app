-- Parsed statement metrics: JSONB instead of per-field application AES (BYTEA).
-- App-level encryption remains for identity + storage secrets (see users, statements.s3_key, merchant_id, agreements).

ALTER TABLE "statement"."parsed_data" DROP CONSTRAINT "parsed_data_encryption_key_id_fkey";

ALTER TABLE "statement"."parsed_data"
  DROP COLUMN "encryption_key_id",
  DROP COLUMN "total_volume_encrypted",
  DROP COLUMN "total_fees_encrypted",
  DROP COLUMN "effective_rate_encrypted",
  DROP COLUMN "interchange_fees_encrypted",
  DROP COLUMN "scheme_fees_encrypted",
  DROP COLUMN "channel_split_encrypted",
  DROP COLUMN "fee_lines_encrypted";

ALTER TABLE "statement"."parsed_data" ADD COLUMN "parsed_payload" JSONB;
