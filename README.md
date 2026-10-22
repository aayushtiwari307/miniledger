# MiniLedger

MiniLedger is a mobile-first lending ledger for tracking money lent to friends. It supports mock phone OTP login, personal loan records, repayments, overdue highlighting, and a summary of lending activity.

## Stack

- **Mobile:** React Native, Expo, TypeScript
- **API:** Node.js, Express, TypeScript
- **Database:** PostgreSQL 16, `pg`, plain SQL migrations and a small migration runner (no ORM)
- **Tests:** Vitest and Supertest; auth integration tests use the separate `miniledger_test` database

Use Node.js **22.13 or newer**. The API binds to `0.0.0.0:3001` for local-network phone testing. The server refuses placeholder or short auth secrets. See [Architecture](docs/architecture.md) for the data model, authentication lifecycle, and business rules.

## 1. Install dependencies and configure local environment

Requirements: Node.js **22.13 or newer** and Docker Desktop (running) for PostgreSQL 16. From the repository root:

```bash
npm install
npm run setup:env
```

The setup script creates `.env` with independent random JWT and OTP HMAC secrets and creates `apps/mobile/.env`. It never overwrites existing environment files. Review `DATABASE_URL`, `DATABASE_TEST_URL`, and `EXPO_PUBLIC_API_BASE_URL` before continuing. The default database credentials are for local development only.

The repository includes `package-lock.json`; use `npm ci` for a reproducible install.

## 2. Start PostgreSQL 16 and run migrations

```bash
npm run db:up
npm run db:migrate
```

The Compose configuration creates `miniledger` and `miniledger_test` on first initialization. PostgreSQL is exposed only on `127.0.0.1:15432` and its timezone is set to `Asia/Kolkata`. The API computes an explicit India business date for overdue logic instead of relying on `CURRENT_DATE` or the phone's clock.

> The initialization script that creates `miniledger_test` only runs when the named Docker volume is first initialized. If you already have a volume created before the init SQL existed, create the test database manually or recreate the local development volume only if you are comfortable losing its data.

The migration runner records applied migration filenames in `schema_migrations`. It is safe to run `npm run db:migrate` again after new migration files are added.

## 3. Start the API and verify its health

```bash
npm run dev:api
```

In another terminal:

```bash
curl http://127.0.0.1:3001/api/health
```

Expected when PostgreSQL is running:

```json
{
  "status": "ok",
  "service": "miniledger-api",
  "database": "connected",
  "timestamp": "<ISO timestamp>"
}
```

The health endpoint returns `503` with a generic error when PostgreSQL is unavailable; it does not expose database credentials. Malformed JSON bodies return `400`, and JSON bodies larger than the 32 KB limit return `413`.

## 4. Mock OTP authentication

Request a code:

```bash
curl -X POST http://127.0.0.1:3001/api/auth/request-otp \
  -H "Content-Type: application/json" \
  -d '{"phone":"+919876543210"}'
```

The API returns `202` and **does not include the OTP in its response**. Read the development server terminal for a line like:

```text
[MOCK OTP] +91…3210 -> 123456
```

Verify the code:

```bash
curl -X POST http://127.0.0.1:3001/api/auth/verify-otp \
  -H "Content-Type: application/json" \
  -d '{"phone":"+919876543210","otp":"123456"}'
```

A successful verification returns a signed JWT and user identifier. Replace `123456` with the code printed in your terminal. Codes expire, can only be used once, have a configurable attempt limit, and a phone has a configurable request cooldown. The database stores an HMAC digest rather than the raw OTP. This is **mock authentication for the assignment**, not real SMS delivery or production phone verification.

The authentication endpoints are:

- `POST /api/auth/request-otp` — `{ "phone": "+919876543210" }`, returns `202`
- `POST /api/auth/verify-otp` — `{ "phone": "+919876543210", "otp": "123456" }`, returns a JWT and user on success

## 5. Loan and summary API

All ledger endpoints require `Authorization: Bearer <token>`. The API scopes every loan query to the authenticated user's JWT subject.

Create a loan (past due dates are allowed so overdue entries can be recorded):

```bash
curl -X POST http://127.0.0.1:3001/api/loans \
  -H 'Authorization: Bearer YOUR_JWT' \
  -H 'Content-Type: application/json' \
  -d '{"friendName":"Sam","amount":1.15,"dueDate":"2026-10-20"}'
```

List the signed-in user's loans and server-calculated statuses:

```bash
curl http://127.0.0.1:3001/api/loans -H 'Authorization: Bearer YOUR_JWT'
```

Mark a loan as repaid (replace the UUID):

```bash
curl -X POST http://127.0.0.1:3001/api/loans/LOAN_UUID/repay \
  -H 'Authorization: Bearer YOUR_JWT'
```

Fetch the summary:

```bash
curl http://127.0.0.1:3001/api/summary -H 'Authorization: Bearer YOUR_JWT'
```

`totalLent` is an all-time sum, including repaid loans. `totalRepaid` sums fully repaid entries. `overdueAmount` sums only unpaid entries whose due date is before the API's current `Asia/Kolkata` business date; a loan due today is not overdue. PostgreSQL `NUMERIC` values are summed in SQL and converted to JSON numbers at the API boundary. Date-only fields stay `YYYY-MM-DD` and are selected as text to avoid timezone shifts.

## 6. Tests and type checks

```bash
npm test
npm run typecheck
npm run build:api
```

The health, OTP cryptography and loan input-validation tests do not need a database. PostgreSQL auth and loan integration tests are skipped unless `DATABASE_TEST_URL` is configured; when configured, each suite refuses to run unless the database name is exactly `miniledger_test`. The suites apply migrations and clear only the test database tables. Vitest test files run serially to prevent one test from truncating another test's data.

If the test database doesn't exist, check `docker compose logs postgres` and the initialization note in section 2.

## 7. Start the Expo app

```bash
npm run dev:mobile
```

Open Expo Go and scan the QR code, or start a simulator.

Configure `EXPO_PUBLIC_API_BASE_URL` in `apps/mobile/.env`:

- **Android emulator:** `http://10.0.2.2:3001`
- **iOS simulator:** `http://127.0.0.1:3001`
- **Physical phone:** `http://YOUR_COMPUTER_LAN_IP:3001` (find the computer's IPv4 address with `ipconfig` on Windows). Phone and computer must be on the same Wi-Fi; allow Node.js through the firewall if prompted.

Restart Expo after changing the base URL. The app now includes phone/OTP login, stores the JWT using Expo SecureStore, restores a saved session, and shows the ledger dashboard. It fetches `/api/loans` and `/api/summary`, refetches after create/repay, and clears the saved session on an authenticated `401`.

## API reference

| Method | Endpoint | Auth | Purpose |
|---|---|---|---|
| `GET` | `/api/health` | No | API and database health |
| `POST` | `/api/auth/request-otp` | No | Request a mock OTP; code is printed in the API terminal |
| `POST` | `/api/auth/verify-otp` | No | Verify OTP and return a JWT |
| `GET` | `/api/loans` | Bearer JWT | List the signed-in user's loans |
| `POST` | `/api/loans` | Bearer JWT | Create a loan entry |
| `POST` | `/api/loans/:id/repay` | Bearer JWT | Mark a loan repaid |
| `GET` | `/api/summary` | Bearer JWT | Return total lent, total repaid and overdue amount |

Unknown routes return `404`. Invalid JSON returns `400`, and JSON request bodies above 32 KB return `413`.

## Demo flow

1. Start PostgreSQL and the API, then launch the Expo app.
2. Enter an international phone number and request a mock OTP.
3. Copy the six-digit OTP from the API terminal and sign in.
4. Add a loan with a decimal amount and a past due date to demonstrate overdue highlighting.
5. Confirm the summary values reflect the new entry.
6. Mark the loan as repaid, confirm the action in the app, and verify that overdue decreases while total repaid increases.
7. Log out and sign in with a different phone number to demonstrate per-user data isolation.

## Verification performed

The following checks were run locally on 22 October 2026:

- [x] `npm run typecheck` — API and mobile.
- [x] `npm run build:api`.
- [x] `npm test` — 5 mobile formatting tests passed.
- [x] `npm run test --workspace=@miniledger/api` — 57 backend tests passed.
- [x] `npx expo export --platform android`.
- [x] Physical Android flow: OTP login, create an overdue loan, verify summary updates, and mark the loan repaid.
- [x] API health check reported `status: ok` and `database: connected`.
- [x] API production dependency audit reported zero vulnerabilities.
- [ ] Clean-clone installation with `npm ci` — not yet performed.

The full dependency audit reports 15 high-severity findings in the Expo/Metro dependency tree. `npm audit fix --force` was not used because npm proposes an incompatible Expo SDK downgrade. Recheck for compatible fixes during dependency maintenance.
## Project layout

```text
miniledger/
├── apps/
│   ├── api/
│   │   ├── migrations/                  # Versioned SQL schema migrations
│   │   └── src/                         # Express routes, auth, data access and tests
│   └── mobile/
│       ├── index.ts                     # Expo root-component entry point
│       ├── App.tsx                      # Login, dashboard, loan form and repayment UI
│       └── src/                         # Typed API client and testable format helpers
├── infra/postgres/init/                 # Create the test database on first init
├── docs/architecture.md                 # Data model, auth lifecycle and business rules
├── scripts/setup-env.mjs                # Generate local environment files and secrets
├── docker-compose.yml
└── .env.example
```

## Design decisions

- `totalLent` is an all-time sum, including repaid loans.
- `totalRepaid` sums fully repaid entries.
- `overdueAmount` sums unpaid entries with a due date strictly before today's `Asia/Kolkata` business date. A loan due today is not overdue.
- Date-only fields are transported as `YYYY-MM-DD`; repayment timestamps are displayed in India time.
- PostgreSQL `NUMERIC` values are aggregated in SQL and converted to JSON numbers at the API boundary.
- The OTP flow is mock authentication for this assignment, not production SMS or identity verification.
