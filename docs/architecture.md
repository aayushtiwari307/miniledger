# MiniLedger Architecture

## Overview

MiniLedger is a React Native mobile app backed by a TypeScript REST API and PostgreSQL database.

```text
Expo / React Native
  └── JSON + Bearer JWT
        ↓
Express API (Node.js + TypeScript)
  ├── Request validation
  ├── Mock OTP authentication and JWT verification
  ├── User-scoped loan operations
  └── Summary aggregation
        ↓
PostgreSQL 16
  ├── users
  ├── otp_challenges
  └── loans
```

## Components

- **Mobile:** Expo, React Native and TypeScript. The app stores its JWT using Expo SecureStore and calls the API through a small typed fetch client.
- **API:** Express routes are separated from server startup so the app can be tested with Supertest without opening a network port.
- **Database:** PostgreSQL with parameterized SQL through `pg`; migrations are versioned SQL files applied by a small migration runner.
- **Tests:** Vitest and Supertest cover validation, OTP logic, HTTP responses and database-backed behavior. Database integration tests must use the dedicated `miniledger_test` database.

## Data model

### `users`

- `id`: UUID primary key.
- `phone_e164`: unique international-format phone number.
- `created_at`: creation timestamp.

### `otp_challenges`

- `id`: UUID primary key.
- `phone_e164`: phone for which the challenge was requested.
- `otp_hmac`: HMAC-SHA256 digest of the phone and one-time code; the raw OTP is not stored.
- `attempts`, `expires_at`, `consumed_at`, `created_at`: challenge lifecycle fields.

### `loans`

- `id`: UUID primary key.
- `user_id`: foreign key to the owner in `users`.
- `friend_name`: trimmed, non-empty name of up to 80 characters.
- `amount`: positive `NUMERIC(12,2)` value.
- `due_date`: PostgreSQL `DATE`.
- `created_at`: creation timestamp.
- `repaid_at`: nullable timestamp set when repaid.

Every loan query uses the authenticated user's ID. Client-provided ownership and status fields are not accepted when creating a loan.

## Authentication lifecycle

1. The client requests an OTP for an E.164 phone number.
2. The API applies a per-phone cooldown, consumes older active challenges, stores an HMAC digest, and prints the code to the server log for this assignment.
3. The client submits the phone and six-digit OTP.
4. The API atomically increments attempts, validates expiry and the HMAC, consumes the challenge once, creates or finds the user, and returns a signed HS256 JWT with an expiry.
5. Protected routes validate the JWT and derive the user ID from its `sub` claim.

This is **mock authentication**. There is no SMS provider, phone ownership verification, or production-grade delivery/rate-limiting service.

## Loan and summary rules

- **Repaid:** `repaid_at IS NOT NULL`.
- **Overdue:** unpaid and `due_date` is before today's `Asia/Kolkata` business date.
- **Outstanding:** unpaid and `due_date` is today or later.
- Past due dates are accepted so overdue entries can be entered and demonstrated.
- Date-only values are returned as `YYYY-MM-DD` strings, not parsed through JavaScript date timezone conversion.
- `totalLent` is the all-time sum of all loans, including repaid loans.
- `totalRepaid` is the sum of repaid loans.
- `overdueAmount` is the sum of unpaid overdue loans.
- Aggregation uses PostgreSQL `SUM`/`COALESCE`; the API converts `NUMERIC` results to JSON numbers at the response boundary.

Repayment uses one conditional `UPDATE ... WHERE repaid_at IS NULL RETURNING` statement. This prevents two concurrent requests from both repaying the same loan.

## Local setup

See the root [README](../README.md) for commands to generate local environment files, start PostgreSQL, run migrations, test the API, and launch Expo. The API defaults to port `3001`. Use `10.0.2.2` for the host machine from an Android emulator, or the computer's LAN IPv4 address when using a physical phone on the same Wi-Fi.
