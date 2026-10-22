import { describe, expect, it } from "vitest";
import { generateOtp, hashOtp, safelyMatchesOtp } from "./modules/auth/otp";

describe("OTP cryptography helpers", () => {
  it("generates exactly six decimal digits, including leading zeroes", () => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      expect(generateOtp()).toMatch(/^\d{6}$/);
    }
  });

  it("stores a deterministic HMAC digest and matches only the correct phone/code pair", () => {
    const secret = "test-secret-that-is-long-enough-for-hmac";
    const phone = "+919876543210";
    const digest = hashOtp(phone, "012345", secret);

    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    expect(safelyMatchesOtp(digest, phone, "012345", secret)).toBe(true);
    expect(safelyMatchesOtp(digest, phone, "012346", secret)).toBe(false);
    expect(safelyMatchesOtp(digest, "+919876543211", "012345", secret)).toBe(false);
    expect(safelyMatchesOtp("not-a-digest", phone, "012345", secret)).toBe(false);
  });
});
