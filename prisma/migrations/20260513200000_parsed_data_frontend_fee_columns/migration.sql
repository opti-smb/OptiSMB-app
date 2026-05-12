-- Match client `parsedData` headline fields: total_transaction_volume, total_fees_charged; drop channel_split; add pos_fees / ecomm_fees.

ALTER TABLE "statement"."parsed_data" DROP COLUMN IF EXISTS "channel_split";

ALTER TABLE "statement"."parsed_data" RENAME COLUMN "total_volume" TO "total_transaction_volume";
ALTER TABLE "statement"."parsed_data" RENAME COLUMN "total_fees" TO "total_fees_charged";

ALTER TABLE "statement"."parsed_data"
  ADD COLUMN IF NOT EXISTS "pos_fees" NUMERIC(24, 6),
  ADD COLUMN IF NOT EXISTS "ecomm_fees" NUMERIC(24, 6);
