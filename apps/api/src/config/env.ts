export interface AuthConfig {
  jwtSecret: string;
  jwtTtlSeconds: number;
  otpHmacSecret: string;
  otpTtlSeconds: number;
  otpCooldownSeconds: number;
  otpMaxAttempts: number;
}

function requiredSecret(name: string, value: string | undefined): string {
  if (!value || value.length < 32 || /replace-this|change-me|example-secret/i.test(value)) {
    throw new Error(`${name} must be a non-placeholder secret with at least 32 characters.`);
  }
  return value;
}

function positiveInteger(name: string, value: string | undefined, fallback: number): number {
  const parsed = value === undefined || value.trim() === "" ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

export function loadAuthConfig(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  const jwtSecret = requiredSecret("JWT_SECRET", env.JWT_SECRET);
  const otpHmacSecret = requiredSecret("OTP_HMAC_SECRET", env.OTP_HMAC_SECRET);

  if (jwtSecret === otpHmacSecret) {
    throw new Error("JWT_SECRET and OTP_HMAC_SECRET must be different secrets.");
  }

  const otpMaxAttempts = positiveInteger("OTP_MAX_ATTEMPTS", env.OTP_MAX_ATTEMPTS, 5);
  if (otpMaxAttempts > 10) {
    throw new Error("OTP_MAX_ATTEMPTS must not be greater than 10.");
  }

  return {
    jwtSecret,
    jwtTtlSeconds: positiveInteger("JWT_TTL_SECONDS", env.JWT_TTL_SECONDS, 604800),
    otpHmacSecret,
    otpTtlSeconds: positiveInteger("OTP_TTL_SECONDS", env.OTP_TTL_SECONDS, 300),
    otpCooldownSeconds: positiveInteger("OTP_COOLDOWN_SECONDS", env.OTP_COOLDOWN_SECONDS, 30),
    otpMaxAttempts,
  };
}
