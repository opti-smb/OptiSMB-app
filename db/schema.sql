-- OptiSMB RDS PostgreSQL schema (Tech Spec §6b — Key Entities)
-- SENSITIVE BYTEA columns: application-layer AES-256-GCM ciphertext; pair with *_hash for lookup where noted.
-- Tables agreement.merchant_agreements and benchmark.acquirers are parent rows required by FKs in §6b
-- (contracted_rates.agreement_id, acquirer_rates.acquirer_id); column sets follow the statement/agreement S3 patterns in the spec.

CREATE SCHEMA IF NOT EXISTS identity;
CREATE SCHEMA IF NOT EXISTS statement;
CREATE SCHEMA IF NOT EXISTS agreement;
CREATE SCHEMA IF NOT EXISTS benchmark;

-- SHA-256 fingerprint (64-char hex) of the active DEK / key handle used for AES-256-GCM.
-- Raw key material is not stored here (KMS / Secrets Manager); rows support rotation and audit.
CREATE TABLE identity.encryption_key_registry (
  encryption_key_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fingerprint_sha256 CHAR(64) NOT NULL,
  purpose VARCHAR(40) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  retired_at TIMESTAMPTZ,
  CONSTRAINT encryption_key_registry_fingerprint_key UNIQUE (fingerprint_sha256)
);

CREATE INDEX encryption_key_registry_active_purpose_idx ON identity.encryption_key_registry (purpose)
  WHERE retired_at IS NULL;

CREATE TABLE identity.users (
  user_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  encryption_key_id UUID REFERENCES identity.encryption_key_registry (encryption_key_id) ON DELETE RESTRICT,
  email_encrypted BYTEA NOT NULL,
  email_hash CHAR(64) NOT NULL,
  business_name_encrypted BYTEA,
  industry VARCHAR(100),
  country CHAR(2),
  tier VARCHAR(10) NOT NULL,
  roles TEXT[] NOT NULL,
  mfa_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT users_email_hash_key UNIQUE (email_hash),
  CONSTRAINT users_tier_chk CHECK (tier IN ('Free', 'L1', 'L2'))
);

CREATE INDEX users_encryption_key_id_idx ON identity.users (encryption_key_id);

CREATE TABLE identity.refresh_tokens (
  jti UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES identity.users (user_id) ON DELETE CASCADE,
  token_hash CHAR(60) NOT NULL,
  family_id UUID NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  revoked_reason VARCHAR(50),
  CONSTRAINT refresh_tokens_revoked_reason_chk CHECK (
    revoked_reason IS NULL
    OR revoked_reason IN ('logout', 'password_change', 'reuse_detected')
  )
);

CREATE INDEX refresh_tokens_user_id_idx ON identity.refresh_tokens (user_id);
CREATE INDEX refresh_tokens_family_id_idx ON identity.refresh_tokens (family_id);

CREATE TABLE statement.statements (
  statement_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES identity.users (user_id) ON DELETE CASCADE,
  encryption_key_id UUID REFERENCES identity.encryption_key_registry (encryption_key_id) ON DELETE RESTRICT,
  s3_key_encrypted BYTEA,
  file_name TEXT NOT NULL,
  file_size_bytes BIGINT NOT NULL,
  file_sha256 CHAR(64),
  merchant_id_encrypted BYTEA,
  acquirer_name TEXT,
  billing_period_from DATE,
  billing_period_to DATE,
  parse_status VARCHAR(30) NOT NULL DEFAULT 'queued',
  idempotency_key UUID NOT NULL,
  CONSTRAINT statements_idempotency_key_key UNIQUE (idempotency_key),
  CONSTRAINT statements_parse_status_chk CHECK (
    parse_status IN ('queued', 'processing', 'complete', 'failed', 'review')
  )
);

CREATE INDEX statements_user_id_idx ON statement.statements (user_id);
CREATE INDEX statements_parse_status_idx ON statement.statements (parse_status);
CREATE INDEX statements_user_billing_from_idx ON statement.statements (user_id, billing_period_from);

CREATE TABLE statement.parsed_data (
  statement_id UUID PRIMARY KEY REFERENCES statement.statements (statement_id) ON DELETE CASCADE,
  encryption_key_id UUID REFERENCES identity.encryption_key_registry (encryption_key_id) ON DELETE RESTRICT,
  total_volume_encrypted BYTEA,
  total_fees_encrypted BYTEA,
  effective_rate_encrypted BYTEA,
  interchange_fees_encrypted BYTEA,
  scheme_fees_encrypted BYTEA,
  channel_split_encrypted BYTEA,
  fee_lines_encrypted BYTEA,
  parsing_confidence VARCHAR(10),
  currency CHAR(3),
  comparison_snapshot_sha256 CHAR(64),
  CONSTRAINT parsed_data_parsing_confidence_chk CHECK (
    parsing_confidence IS NULL
    OR parsing_confidence IN ('high', 'medium', 'low')
  )
);

CREATE TABLE agreement.merchant_agreements (
  agreement_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES identity.users (user_id) ON DELETE CASCADE,
  s3_key_encrypted BYTEA,
  file_name TEXT NOT NULL,
  effective_from DATE,
  superseded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX merchant_agreements_user_id_idx ON agreement.merchant_agreements (user_id);

CREATE TABLE agreement.contracted_rates (
  rate_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agreement_id UUID NOT NULL REFERENCES agreement.merchant_agreements (agreement_id) ON DELETE CASCADE,
  fee_type VARCHAR(255) NOT NULL,
  contracted_rate_encrypted BYTEA,
  card_type VARCHAR(255),
  channel VARCHAR(255),
  notes_encrypted BYTEA
);

CREATE INDEX contracted_rates_agreement_id_idx ON agreement.contracted_rates (agreement_id);

CREATE TABLE benchmark.acquirers (
  acquirer_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE benchmark.acquirer_rates (
  rate_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  acquirer_id UUID NOT NULL REFERENCES benchmark.acquirers (acquirer_id) ON DELETE CASCADE,
  effective_rate NUMERIC(12, 6) NOT NULL,
  data_tier VARCHAR(5) NOT NULL,
  data_as_of DATE NOT NULL,
  is_current BOOLEAN NOT NULL DEFAULT TRUE,
  source_ref TEXT,
  CONSTRAINT acquirer_rates_data_tier_chk CHECK (data_tier IN ('T1', 'T2', 'T3'))
);

CREATE INDEX acquirer_rates_acquirer_current_idx ON benchmark.acquirer_rates (acquirer_id, is_current);
