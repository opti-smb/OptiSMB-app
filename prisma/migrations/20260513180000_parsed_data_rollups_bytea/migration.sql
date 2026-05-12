-- Match Prisma `Bytes` / server ciphertext: roll-up columns are BYTEA again (replaces NUMERIC/JSONB from 20260513140000).

ALTER TABLE "statement"."parsed_data"
  DROP COLUMN "total_volume_encrypted",
  DROP COLUMN "total_fees_encrypted",
  DROP COLUMN "effective_rate_encrypted",
  DROP COLUMN "interchange_fees_encrypted",
  DROP COLUMN "scheme_fees_encrypted",
  DROP COLUMN "channel_split_encrypted",
  DROP COLUMN "fee_lines_encrypted";

ALTER TABLE "statement"."parsed_data"
  ADD COLUMN "total_volume_encrypted" BYTEA,
  ADD COLUMN "total_fees_encrypted" BYTEA,
  ADD COLUMN "effective_rate_encrypted" BYTEA,
  ADD COLUMN "interchange_fees_encrypted" BYTEA,
  ADD COLUMN "scheme_fees_encrypted" BYTEA,
  ADD COLUMN "channel_split_encrypted" BYTEA,
  ADD COLUMN "fee_lines_encrypted" BYTEA;
