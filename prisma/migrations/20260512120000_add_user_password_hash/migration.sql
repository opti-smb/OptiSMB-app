-- OptiSMB: store bcrypt password hash on identity.users (login/register enforce verification).
ALTER TABLE identity.users
  ADD COLUMN IF NOT EXISTS password_hash VARCHAR(72);
