-- This runs only when the PostgreSQL data volume is first initialized.
-- The entrypoint executes this as POSTGRES_USER, which should own the test DB.
CREATE DATABASE miniledger_test;
