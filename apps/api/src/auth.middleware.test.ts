import express from "express";
import jwt from "jsonwebtoken";
import request from "supertest";
import { describe, expect, it } from "vitest";
import type { AuthConfig } from "./config/env";
import { requireAuth, type AuthenticatedRequest } from "./middleware/auth";

const config: AuthConfig = {
  jwtSecret: "middleware-test-jwt-secret-at-least-32-characters",
  jwtTtlSeconds: 3600,
  otpHmacSecret: "middleware-test-otp-secret-at-least-32-characters",
  otpTtlSeconds: 300,
  otpCooldownSeconds: 30,
  otpMaxAttempts: 5,
};

function createProtectedApp() {
  const app = express();
  app.get("/protected", requireAuth(config), (request, response) => {
    const authenticatedRequest = request as AuthenticatedRequest;
    response.status(200).json({ user: authenticatedRequest.user });
  });
  return app;
}

describe("JWT authentication middleware", () => {
  it("rejects a missing or malformed bearer token", async () => {
    const app = createProtectedApp();
    await request(app).get("/protected").expect(401);
    await request(app).get("/protected").set("Authorization", "Bearer not-a-jwt").expect(401);
  });

  it("accepts a valid signed token and exposes only its subject and phone", async () => {
    const token = jwt.sign(
      { phone: "+919876543210" },
      config.jwtSecret,
      { algorithm: "HS256", subject: "a0d45bf7-88c0-42b9-8f1a-8f31a5a60001", expiresIn: 3600 },
    );
    const response = await request(createProtectedApp())
      .get("/protected")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.user).toEqual({
      id: "a0d45bf7-88c0-42b9-8f1a-8f31a5a60001",
      phone: "+919876543210",
    });
  });

  it("rejects tokens signed with a different secret and tokens without a subject", async () => {
    const wrongSecretToken = jwt.sign(
      { phone: "+919876543210" },
      "different-test-secret-that-is-long-enough",
      { algorithm: "HS256", subject: "a0d45bf7-88c0-42b9-8f1a-8f31a5a60001", expiresIn: 3600 },
    );
    const tokenWithoutSubject = jwt.sign(
      { phone: "+919876543210" },
      config.jwtSecret,
      { algorithm: "HS256", expiresIn: 3600 },
    );
    await request(createProtectedApp()).get("/protected").set("Authorization", `Bearer ${wrongSecretToken}`).expect(401);
    await request(createProtectedApp()).get("/protected").set("Authorization", `Bearer ${tokenWithoutSubject}`).expect(401);
  });

  it("rejects unsigned alg:none tokens", async () => {
    const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({
      sub: "a0d45bf7-88c0-42b9-8f1a-8f31a5a60001",
      phone: "+919876543210",
      exp: Math.floor(Date.now() / 1000) + 60,
    })).toString("base64url");
    await request(createProtectedApp()).get("/protected").set("Authorization", `Bearer ${header}.${payload}.`).expect(401);
  });

  it("rejects an expired token", async () => {
    const token = jwt.sign(
      { phone: "+919876543210" },
      config.jwtSecret,
      { algorithm: "HS256", subject: "a0d45bf7-88c0-42b9-8f1a-8f31a5a60001", expiresIn: -1 },
    );
    await request(createProtectedApp())
      .get("/protected")
      .set("Authorization", `Bearer ${token}`)
      .expect(401);
  });
});
