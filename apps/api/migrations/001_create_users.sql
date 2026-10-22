CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_e164 TEXT NOT NULL UNIQUE
    CHECK (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
