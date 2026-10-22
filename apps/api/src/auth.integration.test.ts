import dotenv from "dotenv";
import path from "node:path";
import request from "supertest";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AuthConfig } from "./config/env";
import { createApp } from "./app";
import { applyMigrations } from "./db/migrationRunner";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });
const databaseUrl = process.env.DATABASE_TEST_URL;
const suite = databaseUrl ? describe : describe.skip;
const database = databaseUrl ? new Pool({ connectionString: databaseUrl, max: 2 }) : null;
const migrationsDirectory = path.resolve(__dirname, "../migrations");

const authConfig: AuthConfig = {
  jwtSecret: "unit-test-jwt-secret-which-is-over-32-chars",
  jwtTtlSeconds: 3600,
  otpHmacSecret: "unit-test-otp-hmac-secret-over-32-chars",
  otpTtlSeconds: 300,
  otpCooldownSeconds: 30,
  otpMaxAttempts: 5,
};

suite("mock OTP authentication (PostgreSQL integration)", () => {
  let sentOtps: Array<{ phone: string; code: string }> = [];
  let app: ReturnType<typeof createApp>;

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
    await database.query("TRUNCATE TABLE otp_challenges, users CASCADE");
    sentOtps = [];
    app = createApp(database, authConfig, (phone, code) => sentOtps.push({ phone, code }));
  });

  afterAll(async () => {
    await database?.end();
  });

  it("returns 202 without returning the OTP and stores only an HMAC digest", async () => {
    const phone = "+919876543210";
    const response = await request(app).post("/api/auth/request-otp").send({ phone });

    expect(response.status).toBe(202);
    expect(response.body).toMatchObject({ expiresInSeconds: 300 });
    expect(JSON.stringify(response.body)).not.toContain(sentOtps[0]?.code);
    expect(sentOtps).toHaveLength(1);
    expect(sentOtps[0].phone).toBe(phone);

    const stored = await database!.query(
      "SELECT otp_hmac, attempts, expires_at > NOW() AS not_expired FROM otp_challenges WHERE phone_e164 = $1",
      [phone],
    );
    expect(stored.rows).toHaveLength(1);
    expect(stored.rows[0].otp_hmac).toMatch(/^[a-f0-9]{64}$/);
    expect(stored.rows[0].otp_hmac).not.toBe(sentOtps[0].code);
    expect(stored.rows[0].attempts).toBe(0);
    expect(stored.rows[0].not_expired).toBe(true);
  });

  it("rejects malformed phone input before creating a challenge", async () => {
    const response = await request(app).post("/api/auth/request-otp").send({ phone: "9876543210" });
    expect(response.status).toBe(400);
    expect(sentOtps).toHaveLength(0);
    const rows = await database!.query("SELECT id FROM otp_challenges");
    expect(rows.rowCount).toBe(0);
  });

  it("uses the same generic error when no active challenge exists", async () => {
    const response = await request(app)
      .post("/api/auth/verify-otp")
      .send({ phone: "+919876543210", otp: "123456" });
    expect(response.status).toBe(401);
    expect(response.body.error).toEqual({
      code: "INVALID_OR_EXPIRED_OTP",
      message: "Invalid or expired code",
    });
  });

  it("verifies a correct code once, returns a JWT, and rejects replay", async () => {
    const phone = "+919876543210";
    await request(app).post("/api/auth/request-otp").send({ phone }).expect(202);
    const otp = sentOtps[0].code;

    const first = await request(app).post("/api/auth/verify-otp").send({ phone, otp });
    expect(first.status).toBe(200);
    expect(first.body.token).toEqual(expect.any(String));
    expect(first.body.user).toMatchObject({ phone });
    expect(first.body.expiresInSeconds).toBe(3600);

    const replay = await request(app).post("/api/auth/verify-otp").send({ phone, otp });
    expect(replay.status).toBe(401);
    expect(replay.body.error).toEqual({
      code: "INVALID_OR_EXPIRED_OTP",
      message: "Invalid or expired code",
    });
  });

  it("allows only one concurrent verification to consume the same OTP", async () => {
    const phone = "+919876543210";
    await request(app).post("/api/auth/request-otp").send({ phone }).expect(202);
    const otp = sentOtps[0].code;
    const responses = await Promise.all(
      Array.from({ length: 6 }, () => request(app).post("/api/auth/verify-otp").send({ phone, otp })),
    );

    expect(responses.filter((response) => response.status === 200)).toHaveLength(1);
    expect(responses.filter((response) => response.status === 401)).toHaveLength(5);
  });

  it("enforces the attempt limit even when the correct code is supplied afterward", async () => {
    const phone = "+919876543210";
    await request(app).post("/api/auth/request-otp").send({ phone }).expect(202);
    const correctCode = sentOtps[0].code;
    const wrongCode = correctCode === "000000" ? "000001" : "000000";

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await request(app).post("/api/auth/verify-otp").send({ phone, otp: wrongCode });
      expect(response.status).toBe(401);
    }

    const correctAfterLimit = await request(app).post("/api/auth/verify-otp").send({ phone, otp: correctCode });
    expect(correctAfterLimit.status).toBe(401);
    const stored = await database!.query("SELECT attempts FROM otp_challenges WHERE phone_e164 = $1", [phone]);
    expect(stored.rows[0].attempts).toBe(5);
  });

  it("returns the same verification error for an expired challenge", async () => {
    const phone = "+919876543210";
    await request(app).post("/api/auth/request-otp").send({ phone }).expect(202);
    await database!.query("UPDATE otp_challenges SET created_at = NOW() - INTERVAL '10 minutes', expires_at = NOW() - INTERVAL '1 minute' WHERE phone_e164 = $1", [phone]);

    const response = await request(app)
      .post("/api/auth/verify-otp")
      .send({ phone, otp: sentOtps[0].code });
    expect(response.status).toBe(401);
    expect(response.body.error).toEqual({
      code: "INVALID_OR_EXPIRED_OTP",
      message: "Invalid or expired code",
    });
  });

  it("invalidates the previous OTP when a fresh challenge is requested after cooldown", async () => {
    const phone = "+919876543210";
    await request(app).post("/api/auth/request-otp").send({ phone }).expect(202);
    const oldOtp = sentOtps[0].code;
    await database!.query(
      "UPDATE otp_challenges SET created_at = NOW() - INTERVAL '1 minute' WHERE phone_e164 = $1",
      [phone],
    );

    await request(app).post("/api/auth/request-otp").send({ phone }).expect(202);
    const newOtp = sentOtps[1].code;
    expect(newOtp).not.toBe(oldOtp);
    await request(app).post("/api/auth/verify-otp").send({ phone, otp: oldOtp }).expect(401);
    await request(app).post("/api/auth/verify-otp").send({ phone, otp: newOtp }).expect(200);
  });

  it("applies a per-phone cooldown", async () => {
    const phone = "+919876543210";
    await request(app).post("/api/auth/request-otp").send({ phone }).expect(202);
    const second = await request(app).post("/api/auth/request-otp").send({ phone });
    expect(second.status).toBe(429);
    expect(second.body.error.code).toBe("OTP_COOLDOWN");
    expect(sentOtps).toHaveLength(1);
  });
});
