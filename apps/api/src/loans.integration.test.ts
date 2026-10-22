import dotenv from "dotenv";
import path from "node:path";
import jwt from "jsonwebtoken";
import request from "supertest";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AuthConfig } from "./config/env";
import { createApp } from "./app";
import { applyMigrations } from "./db/migrationRunner";
import { getIndiaBusinessDate } from "./modules/loans/loan.service";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });
const databaseUrl = process.env.DATABASE_TEST_URL;
const suite = databaseUrl ? describe : describe.skip;
const database = databaseUrl ? new Pool({ connectionString: databaseUrl, max: 2 }) : null;
const migrationsDirectory = path.resolve(__dirname, "../migrations");
const authConfig: AuthConfig = {
  jwtSecret: "loan-test-jwt-secret-which-is-long-enough-12345",
  jwtTtlSeconds: 3600,
  otpHmacSecret: "loan-test-otp-hmac-secret-over-32-characters-67890",
  otpTtlSeconds: 300,
  otpCooldownSeconds: 30,
  otpMaxAttempts: 5,
};

function addDays(dateString: string, days: number): string {
  const [year, month, day] = dateString.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

suite("loan and summary API (PostgreSQL integration)", () => {
  let userId = "";
  let otherUserId = "";
  let app: ReturnType<typeof createApp>;
  let token = "";
  let otherToken = "";

  beforeAll(async () => {
    if (!database || !databaseUrl) throw new Error("Test database is not configured.");
    const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\//, ""));
    if (databaseName !== "miniledger_test") {
      throw new Error("Safety stop: DATABASE_TEST_URL must point to the miniledger_test database.");
    }
    await applyMigrations(database, migrationsDirectory);
  });

  beforeEach(async () => {
    if (!database) throw new Error("Test database is not configured.");
    await database.query("TRUNCATE TABLE loans, otp_challenges, users CASCADE");
    const users = await database.query<{ id: string; phone_e164: string }>(
      `INSERT INTO users (phone_e164) VALUES ($1), ($2) RETURNING id::text AS id, phone_e164`,
      ["+919876543210", "+919876543211"],
    );
    const first = users.rows.find((row) => row.phone_e164 === "+919876543210");
    const second = users.rows.find((row) => row.phone_e164 === "+919876543211");
    if (!first || !second) throw new Error("Failed to prepare integration-test users.");
    userId = first.id;
    otherUserId = second.id;
    token = jwt.sign({ phone: "+919876543210" }, authConfig.jwtSecret, { algorithm: "HS256", subject: userId, expiresIn: 3600 });
    otherToken = jwt.sign({ phone: "+919876543211" }, authConfig.jwtSecret, { algorithm: "HS256", subject: otherUserId, expiresIn: 3600 });
    app = createApp(database, authConfig);
  });

  afterAll(async () => {
    await database?.end();
  });

  it("protects loan and summary endpoints", async () => {
    await request(app).get("/api/loans").expect(401);
    await request(app).get("/api/summary").set("Authorization", "Bearer nonsense").expect(401);
  });

  it("creates a valid loan and preserves the date-only value", async () => {
    const response = await request(app)
      .post("/api/loans")
      .set("Authorization", `Bearer ${token}`)
      .send({ friendName: "  Sam  ", amount: 1.15, dueDate: addDays(getIndiaBusinessDate(), 1) })
      .expect(201);
    expect(response.body.loan).toMatchObject({ friendName: "Sam", amount: 1.15, status: "outstanding", repaidAt: null });
    expect(response.body.loan.dueDate).toBe(addDays(getIndiaBusinessDate(), 1));
  });

  it.each([
    ["zero amount", { friendName: "Sam", amount: 0, dueDate: "2026-10-22" }],
    ["negative amount", { friendName: "Sam", amount: -2, dueDate: "2026-10-22" }],
    ["three decimals", { friendName: "Sam", amount: 1.234, dueDate: "2026-10-22" }],
    ["blank friend", { friendName: "  ", amount: 10, dueDate: "2026-10-22" }],
    ["impossible date", { friendName: "Sam", amount: 10, dueDate: "2026-02-30" }],
  ])("rejects invalid loan input: %s", async (_label, input) => {
    await request(app).post("/api/loans").set("Authorization", `Bearer ${token}`).send(input).expect(400);
  });

  it("lists only the authenticated user's loans and computes statuses using India date", async () => {
    const today = getIndiaBusinessDate();
    const yesterday = addDays(today, -1);
    const tomorrow = addDays(today, 1);
    await database!.query(
      `INSERT INTO loans (user_id, friend_name, amount, due_date) VALUES
       ($1, 'Overdue friend', 1000, $2::date),
       ($1, 'Due today', 500, $3::date),
       ($1, 'Future friend', 200, $4::date),
       ($5, 'Private loan', 999, $2::date)`,
      [userId, yesterday, today, tomorrow, otherUserId],
    );
    const response = await request(app).get("/api/loans").set("Authorization", `Bearer ${token}`).expect(200);
    expect(response.body.loans).toHaveLength(3);
    expect(response.body.loans.map((loan: { friendName: string; status: string; dueDate: string }) => [loan.friendName, loan.status, loan.dueDate])).toContainEqual(["Overdue friend", "overdue", yesterday]);
    expect(response.body.loans.map((loan: { friendName: string; status: string; dueDate: string }) => [loan.friendName, loan.status, loan.dueDate])).toContainEqual(["Due today", "outstanding", today]);
    expect(response.body.loans.map((loan: { friendName: string; status: string; dueDate: string }) => [loan.friendName, loan.status, loan.dueDate])).toContainEqual(["Future friend", "outstanding", tomorrow]);
  });

  it("repays once, rejects a second repayment, and hides other users' loans", async () => {
    const inserted = await database!.query<{ id: string }>(
      "INSERT INTO loans (user_id, friend_name, amount, due_date) VALUES ($1, 'Alex', 25.50, $2::date) RETURNING id::text AS id",
      [userId, addDays(getIndiaBusinessDate(), -1)],
    );
    const loanId = inserted.rows[0].id;
    const first = await request(app).post(`/api/loans/${loanId}/repay`).set("Authorization", `Bearer ${token}`).expect(200);
    expect(first.body.loan.status).toBe("repaid");
    expect(first.body.loan.repaidAt).toEqual(expect.any(String));
    const second = await request(app).post(`/api/loans/${loanId}/repay`).set("Authorization", `Bearer ${token}`).expect(409);
    expect(second.body.error.code).toBe("ALREADY_REPAID");
    await request(app).post(`/api/loans/${loanId}/repay`).set("Authorization", `Bearer ${otherToken}`).expect(404);
    await request(app).post("/api/loans/not-a-uuid/repay").set("Authorization", `Bearer ${token}`).expect(400);
  });

  it("allows only one of eight concurrent repayment requests to succeed", async () => {
    const inserted = await database!.query<{ id: string }>(
      "INSERT INTO loans (user_id, friend_name, amount, due_date) VALUES ($1, 'Concurrent', 12.34, $2::date) RETURNING id::text AS id",
      [userId, addDays(getIndiaBusinessDate(), 1)],
    );
    const loanId = inserted.rows[0].id;
    const responses = await Promise.all(
      Array.from({ length: 8 }, () => request(app).post(`/api/loans/${loanId}/repay`).set("Authorization", `Bearer ${token}`)),
    );

    expect(responses.filter((response) => response.status === 200)).toHaveLength(1);
    expect(responses.filter((response) => response.status === 409)).toHaveLength(7);
  });

  it("ignores client-supplied ownership and repayment fields when creating a loan", async () => {
    const response = await request(app)
      .post("/api/loans")
      .set("Authorization", `Bearer ${token}`)
      .send({ friendName: "Safe input", amount: 0.3, dueDate: addDays(getIndiaBusinessDate(), 1), user_id: otherUserId, repaidAt: "2026-01-01T00:00:00.000Z", status: "repaid" })
      .expect(201);

    expect(response.body.loan).toMatchObject({ friendName: "Safe input", amount: 0.3, repaidAt: null, status: "outstanding" });
    const otherUserLoans = await request(app).get("/api/loans").set("Authorization", `Bearer ${otherToken}`).expect(200);
    expect(otherUserLoans.body.loans).toHaveLength(0);
  });

  it("sums fractional amounts using PostgreSQL numeric precision", async () => {
    await database!.query(
      `INSERT INTO loans (user_id, friend_name, amount, due_date) VALUES
       ($1, 'Fraction A', 0.10, $2::date),
       ($1, 'Fraction B', 0.20, $2::date)`,
      [userId, addDays(getIndiaBusinessDate(), 1)],
    );
    const response = await request(app).get("/api/summary").set("Authorization", `Bearer ${token}`).expect(200);
    expect(response.body.summary).toEqual({ totalLent: 0.3, totalRepaid: 0, overdueAmount: 0 });
  });

  it("returns zeros for an empty ledger", async () => {
    const response = await request(app).get("/api/summary").set("Authorization", `Bearer ${token}`).expect(200);
    expect(response.body.summary).toEqual({ totalLent: 0, totalRepaid: 0, overdueAmount: 0 });
  });

  it("aggregates the mixed dataset correctly and updates totals after repayment", async () => {
    const today = getIndiaBusinessDate();
    const yesterday = addDays(today, -1);
    const tomorrow = addDays(today, 1);
    const lastWeek = addDays(today, -7);
    const inserted = await database!.query<{ id: string; friend_name: string }>(
      `INSERT INTO loans (user_id, friend_name, amount, due_date, repaid_at) VALUES
       ($1, 'Overdue', 1000, $2::date, NULL),
       ($1, 'Today', 500, $3::date, NULL),
       ($1, 'Tomorrow', 200, $4::date, NULL),
       ($1, 'Repaid', 300, $5::date, NOW())
       RETURNING id::text AS id, friend_name`,
      [userId, yesterday, today, tomorrow, lastWeek],
    );
    await database!.query(
      "INSERT INTO loans (user_id, friend_name, amount, due_date) VALUES ($1, 'Other user', 9000, $2::date)",
      [otherUserId, yesterday],
    );

    const summaryBefore = await request(app).get("/api/summary").set("Authorization", `Bearer ${token}`).expect(200);
    expect(summaryBefore.body.summary).toEqual({ totalLent: 2000, totalRepaid: 300, overdueAmount: 1000 });

    const overdueLoan = inserted.rows.find((row) => row.friend_name === "Overdue");
    if (!overdueLoan) throw new Error("Overdue test loan was not inserted.");
    await request(app).post(`/api/loans/${overdueLoan.id}/repay`).set("Authorization", `Bearer ${token}`).expect(200);
    const summaryAfter = await request(app).get("/api/summary").set("Authorization", `Bearer ${token}`).expect(200);
    expect(summaryAfter.body.summary).toEqual({ totalLent: 2000, totalRepaid: 1300, overdueAmount: 0 });
  });
});
