CREATE TABLE loans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  friend_name TEXT NOT NULL
    CHECK (char_length(btrim(friend_name)) BETWEEN 1 AND 80),
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  due_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  repaid_at TIMESTAMPTZ NULL
);

CREATE INDEX loans_user_created_idx ON loans (user_id, created_at DESC);
