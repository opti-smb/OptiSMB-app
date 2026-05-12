-- Track save time so statement lists default to newest upload (not newest billing period).
ALTER TABLE "statement"."statements" ADD COLUMN IF NOT EXISTS "uploaded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX IF NOT EXISTS "statements_user_id_uploaded_at_idx" ON "statement"."statements" ("user_id", "uploaded_at" DESC);
