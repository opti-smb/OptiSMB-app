-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "agreement";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "benchmark";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "identity";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "statement";

-- CreateTable
CREATE TABLE "identity"."encryption_key_registry" (
    "encryption_key_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "fingerprint_sha256" CHAR(64) NOT NULL,
    "purpose" VARCHAR(40) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retired_at" TIMESTAMPTZ(6),

    CONSTRAINT "encryption_key_registry_pkey" PRIMARY KEY ("encryption_key_id")
);

-- CreateTable
CREATE TABLE "identity"."users" (
    "user_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "encryption_key_id" UUID,
    "email_encrypted" BYTEA NOT NULL,
    "email_hash" CHAR(64) NOT NULL,
    "business_name_encrypted" BYTEA,
    "industry" VARCHAR(100),
    "country" CHAR(2),
    "tier" VARCHAR(10) NOT NULL,
    "roles" TEXT[],
    "mfa_enabled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "users_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "identity"."refresh_tokens" (
    "jti" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "token_hash" CHAR(60) NOT NULL,
    "family_id" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "revoked_reason" VARCHAR(50),

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("jti")
);

-- CreateTable
CREATE TABLE "statement"."statements" (
    "statement_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "encryption_key_id" UUID,
    "s3_key_encrypted" BYTEA,
    "file_name" TEXT NOT NULL,
    "file_size_bytes" BIGINT NOT NULL,
    "file_sha256" CHAR(64),
    "merchant_id_encrypted" BYTEA,
    "acquirer_name" TEXT,
    "billing_period_from" DATE,
    "billing_period_to" DATE,
    "parse_status" VARCHAR(30) NOT NULL DEFAULT 'queued',
    "idempotency_key" UUID NOT NULL,

    CONSTRAINT "statements_pkey" PRIMARY KEY ("statement_id")
);

-- CreateTable
CREATE TABLE "statement"."parsed_data" (
    "statement_id" UUID NOT NULL,
    "encryption_key_id" UUID,
    "total_volume_encrypted" BYTEA,
    "total_fees_encrypted" BYTEA,
    "effective_rate_encrypted" BYTEA,
    "interchange_fees_encrypted" BYTEA,
    "scheme_fees_encrypted" BYTEA,
    "channel_split_encrypted" BYTEA,
    "fee_lines_encrypted" BYTEA,
    "parsing_confidence" VARCHAR(10),
    "currency" CHAR(3),
    "comparison_snapshot_sha256" CHAR(64),

    CONSTRAINT "parsed_data_pkey" PRIMARY KEY ("statement_id")
);

-- CreateTable
CREATE TABLE "agreement"."merchant_agreements" (
    "agreement_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "s3_key_encrypted" BYTEA,
    "file_name" TEXT NOT NULL,
    "effective_from" DATE,
    "superseded_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "merchant_agreements_pkey" PRIMARY KEY ("agreement_id")
);

-- CreateTable
CREATE TABLE "agreement"."contracted_rates" (
    "rate_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "agreement_id" UUID NOT NULL,
    "fee_type" VARCHAR(255) NOT NULL,
    "contracted_rate_encrypted" BYTEA,
    "card_type" VARCHAR(255),
    "channel" VARCHAR(255),
    "notes_encrypted" BYTEA,

    CONSTRAINT "contracted_rates_pkey" PRIMARY KEY ("rate_id")
);

-- CreateTable
CREATE TABLE "benchmark"."acquirers" (
    "acquirer_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "acquirers_pkey" PRIMARY KEY ("acquirer_id")
);

-- CreateTable
CREATE TABLE "benchmark"."acquirer_rates" (
    "rate_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "acquirer_id" UUID NOT NULL,
    "effective_rate" DECIMAL(12,6) NOT NULL,
    "data_tier" VARCHAR(5) NOT NULL,
    "data_as_of" DATE NOT NULL,
    "is_current" BOOLEAN NOT NULL DEFAULT true,
    "source_ref" TEXT,

    CONSTRAINT "acquirer_rates_pkey" PRIMARY KEY ("rate_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "encryption_key_registry_fingerprint_sha256_key" ON "identity"."encryption_key_registry"("fingerprint_sha256");

-- CreateIndex
CREATE INDEX "encryption_key_registry_purpose_idx" ON "identity"."encryption_key_registry"("purpose");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_hash_key" ON "identity"."users"("email_hash");

-- CreateIndex
CREATE INDEX "users_encryption_key_id_idx" ON "identity"."users"("encryption_key_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "identity"."refresh_tokens"("user_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_family_id_idx" ON "identity"."refresh_tokens"("family_id");

-- CreateIndex
CREATE UNIQUE INDEX "statements_idempotency_key_key" ON "statement"."statements"("idempotency_key");

-- CreateIndex
CREATE INDEX "statements_user_id_idx" ON "statement"."statements"("user_id");

-- CreateIndex
CREATE INDEX "statements_parse_status_idx" ON "statement"."statements"("parse_status");

-- CreateIndex
CREATE INDEX "statements_user_id_billing_period_from_idx" ON "statement"."statements"("user_id", "billing_period_from");

-- CreateIndex
CREATE INDEX "merchant_agreements_user_id_idx" ON "agreement"."merchant_agreements"("user_id");

-- CreateIndex
CREATE INDEX "contracted_rates_agreement_id_idx" ON "agreement"."contracted_rates"("agreement_id");

-- CreateIndex
CREATE INDEX "acquirer_rates_acquirer_id_is_current_idx" ON "benchmark"."acquirer_rates"("acquirer_id", "is_current");

-- AddForeignKey
ALTER TABLE "identity"."users" ADD CONSTRAINT "users_encryption_key_id_fkey" FOREIGN KEY ("encryption_key_id") REFERENCES "identity"."encryption_key_registry"("encryption_key_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "identity"."refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "statement"."statements" ADD CONSTRAINT "statements_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "statement"."statements" ADD CONSTRAINT "statements_encryption_key_id_fkey" FOREIGN KEY ("encryption_key_id") REFERENCES "identity"."encryption_key_registry"("encryption_key_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "statement"."parsed_data" ADD CONSTRAINT "parsed_data_statement_id_fkey" FOREIGN KEY ("statement_id") REFERENCES "statement"."statements"("statement_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "statement"."parsed_data" ADD CONSTRAINT "parsed_data_encryption_key_id_fkey" FOREIGN KEY ("encryption_key_id") REFERENCES "identity"."encryption_key_registry"("encryption_key_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agreement"."merchant_agreements" ADD CONSTRAINT "merchant_agreements_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agreement"."contracted_rates" ADD CONSTRAINT "contracted_rates_agreement_id_fkey" FOREIGN KEY ("agreement_id") REFERENCES "agreement"."merchant_agreements"("agreement_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "benchmark"."acquirer_rates" ADD CONSTRAINT "acquirer_rates_acquirer_id_fkey" FOREIGN KEY ("acquirer_id") REFERENCES "benchmark"."acquirers"("acquirer_id") ON DELETE CASCADE ON UPDATE CASCADE;
