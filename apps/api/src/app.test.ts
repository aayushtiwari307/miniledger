import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import type { AuthConfig } from "./config/env";
import { createApp } from "./app";

const testAuthConfig: AuthConfig = {
  jwtSecret: "j".repeat(40),
  jwtTtlSeconds: 3600,
  otpHmacSecret: "o".repeat(40),
  otpTtlSeconds: 300,
  otpCooldownSeconds: 30,
  otpMaxAttempts: 5,
};

describe("GET /api/health", () => {
  it("returns healthy when the database query succeeds", async () => {
    const database = { query: vi.fn().mockResolvedValue({ rows: [{ "?column?": 1 }] }) } as unknown as Pool;
    const response = await request(createApp(database, testAuthConfig)).get("/api/health");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      status: "ok",
      service: "miniledger-api",
      database: "connected",
    });
    expect(typeof response.body.timestamp).toBe("string");
    expect(database.query).toHaveBeenCalledWith("SELECT 1");
  });

  it("returns 503 without exposing database internals when the query fails", async () => {
    const database = {
      query: vi.fn().mockRejectedValue(new Error("password=not-for-clients")),
    } as unknown as Pool;
    const response = await request(createApp(database, testAuthConfig)).get("/api/health");

    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      status: "error",
      service: "miniledger-api",
      database: "unavailable",
    });
    expect(JSON.stringify(response.body)).not.toContain("password");
  });

  it("returns a JSON 404 for unknown routes", async () => {
    const database = { query: vi.fn() } as unknown as Pool;
    const response = await request(createApp(database, testAuthConfig)).get("/not-a-route");

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: { code: "NOT_FOUND", message: "Route not found" } });
  });

  it("returns 404 rather than requiring auth for unknown API routes", async () => {
    const database = { query: vi.fn() } as unknown as Pool;
    const response = await request(createApp(database, testAuthConfig)).get("/api/unknown-route");

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: { code: "NOT_FOUND", message: "Route not found" } });
  });
});


describe("request body parsing", () => {
  const database = { query: vi.fn() } as unknown as Pool;

  it("returns 400 for malformed JSON", async () => {
    const response = await request(createApp(database, testAuthConfig))
      .post("/api/auth/request-otp")
      .set("content-type", "application/json")
      .send('{"phone":');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: { code: "INVALID_JSON", message: "Request body must contain valid JSON." },
    });
  });

  it("returns 413 when the JSON body exceeds 32 KB", async () => {
    const response = await request(createApp(database, testAuthConfig))
      .post("/api/auth/request-otp")
      .send({ payload: "x".repeat(40 * 1024) });

    expect(response.status).toBe(413);
    expect(response.body).toEqual({
      error: { code: "PAYLOAD_TOO_LARGE", message: "Request body must not exceed 32 KB." },
    });
  });
});
