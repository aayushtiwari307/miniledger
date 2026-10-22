import { createHmac, randomInt, timingSafeEqual } from "node:crypto";

export function generateOtp(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export function hashOtp(phone: string, otp: string, secret: string): string {
  return createHmac("sha256", secret).update(`${phone}:${otp}`, "utf8").digest("hex");
}

export function safelyMatchesOtp(
  storedHexDigest: string,
  phone: string,
  submittedOtp: string,
  secret: string,
): boolean {
  // The stored value should be a 32-byte SHA-256 HMAC represented as 64 hex characters.
  if (!/^[a-f0-9]{64}$/.test(storedHexDigest)) return false;
  const stored = Buffer.from(storedHexDigest, "hex");
  const submitted = Buffer.from(hashOtp(phone, submittedOtp, secret), "hex");
  return stored.length === submitted.length && timingSafeEqual(stored, submitted);
}

export type OtpSender = (phone: string, code: string) => void;

export const sendOtp: OtpSender = (phone, code) => {
  // Assignment-only mock delivery. Never return this code from the API response.
  const maskedPhone = phone.length > 4 ? `${phone.slice(0, 3)}…${phone.slice(-4)}` : phone;
  console.log(`[MOCK OTP] ${maskedPhone} -> ${code}`);
};
