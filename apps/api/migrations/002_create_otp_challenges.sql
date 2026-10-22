CREATE TABLE otp_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_e164 TEXT NOT NULL
    CHECK (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  otp_hmac TEXT NOT NULL
    CHECK (otp_hmac ~ '^[a-f0-9]{64}$'),
  expires_at TIMESTAMPTZ NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  consumed_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (expires_at > created_at)
);

CREATE INDEX otp_challenges_phone_created_idx
  ON otp_challenges (phone_e164, created_at DESC);
