import { describe, expect, it } from "vitest";
import { loadAuthConfig } from "./config/env";

describe("authentication environment validation", () => {
  const goodEnv = {
    JWT_SECRET: "jwt-secret-which-is-long-enough-for-this-test-12345",
    OTP_HMAC_SECRET: "otp-secret-which-is-long-enough-and-different-67890",
  };

  it("loads defaults when separate strong secrets are provided", () => {
    expect(loadAuthConfig(goodEnv)).toMatchObject({
      jwtTtlSeconds: 604800,
      otpTtlSeconds: 300,
      otpCooldownSeconds: 30,
      otpMaxAttempts: 5,
    });
  });

  it("rejects missing, placeholder, or short secrets", () => {
    expect(() => loadAuthConfig({ ...goodEnv, JWT_SECRET: undefined })).toThrow(/JWT_SECRET/);
    expect(() => loadAuthConfig({ ...goodEnv, JWT_SECRET: "too-short" })).toThrow(/JWT_SECRET/);
    expect(() => loadAuthConfig({ ...goodEnv, OTP_HMAC_SECRET: "replace-this-value-with-a-long-enough-string" })).toThrow(/OTP_HMAC_SECRET/);
  });

  it("rejects reused secrets and invalid attempt limits", () => {
    expect(() => loadAuthConfig({ JWT_SECRET: goodEnv.JWT_SECRET, OTP_HMAC_SECRET: goodEnv.JWT_SECRET })).toThrow(/must be different/);
    expect(() => loadAuthConfig({ ...goodEnv, OTP_MAX_ATTEMPTS: "0" })).toThrow(/OTP_MAX_ATTEMPTS/);
    expect(() => loadAuthConfig({ ...goodEnv, OTP_MAX_ATTEMPTS: "11" })).toThrow(/not be greater than 10/);
  });
});
