-- Rename AES-GCM BYTEA columns: reserve clear crypto naming (`*_ciphertext`), avoid generic `*_encrypted` suffix in DB.

ALTER TABLE "identity"."users" RENAME COLUMN "email_encrypted" TO "email_ciphertext";
ALTER TABLE "identity"."users" RENAME COLUMN "business_name_encrypted" TO "business_name_ciphertext";

ALTER TABLE "statement"."statements" RENAME COLUMN "s3_key_encrypted" TO "s3_key_ciphertext";
ALTER TABLE "statement"."statements" RENAME COLUMN "merchant_id_encrypted" TO "merchant_id_ciphertext";

ALTER TABLE "agreement"."merchant_agreements" RENAME COLUMN "s3_key_encrypted" TO "s3_key_ciphertext";

ALTER TABLE "agreement"."contracted_rates" RENAME COLUMN "contracted_rate_encrypted" TO "contracted_rate_ciphertext";
ALTER TABLE "agreement"."contracted_rates" RENAME COLUMN "notes_encrypted" TO "notes_ciphertext";
