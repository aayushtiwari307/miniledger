export interface RequestOtpInput {
  phone: string;
}

export interface VerifyOtpInput {
  phone: string;
  otp: string;
}

const E164_PHONE_PATTERN = /^\+[1-9]\d{7,14}$/;
const OTP_PATTERN = /^\d{6}$/;

export function parseRequestOtpInput(value: unknown): RequestOtpInput | null {
  if (!isRecord(value) || typeof value.phone !== "string") return null;
  const phone = value.phone.trim();
  if (!E164_PHONE_PATTERN.test(phone)) return null;
  return { phone };
}

export function parseVerifyOtpInput(value: unknown): VerifyOtpInput | null {
  if (!isRecord(value) || typeof value.phone !== "string" || typeof value.otp !== "string") {
    return null;
  }

  const phone = value.phone.trim();
  const otp = value.otp.trim();
  if (!E164_PHONE_PATTERN.test(phone) || !OTP_PATTERN.test(otp)) return null;
  return { phone, otp };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
