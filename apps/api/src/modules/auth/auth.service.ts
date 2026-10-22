import type { Pool, PoolClient } from "pg";
import jwt from "jsonwebtoken";
import type { AuthConfig } from "../../config/env";
import { generateOtp, hashOtp, safelyMatchesOtp, type OtpSender, sendOtp } from "./otp";

export class AuthServiceError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AuthServiceError";
  }
}

export interface AuthenticatedUser {
  id: string;
  phone: string;
}

export interface VerifyOtpResult {
  token: string;
  user: AuthenticatedUser;
  expiresInSeconds: number;
}

const invalidOtpError = () => new AuthServiceError(401, "INVALID_OR_EXPIRED_OTP", "Invalid or expired code");

export async function requestOtp(
  database: Pool,
  phone: string,
  config: AuthConfig,
  otpSender: OtpSender = sendOtp,
): Promise<{ expiresInSeconds: number }> {
  const client = await database.connect();
  let inTransaction = false;
  const code = generateOtp();

  try {
    await client.query("BEGIN");
    inTransaction = true;

    // Serialize requests for the same phone so two simultaneous requests cannot bypass cooldown.
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [phone]);
    const recentChallenge = await client.query(
      `SELECT EXISTS (
         SELECT 1
         FROM otp_challenges
         WHERE phone_e164 = $1
           AND created_at > NOW() - ($2::integer * INTERVAL '1 second')
       ) AS cooldown_active`,
      [phone, config.otpCooldownSeconds],
    );

    if (recentChallenge.rows[0]?.cooldown_active === true) {
      await client.query("ROLLBACK");
      inTransaction = false;
      throw new AuthServiceError(429, "OTP_COOLDOWN", `Wait ${config.otpCooldownSeconds} seconds before requesting another code.`);
    }

    // Only the newest challenge should remain usable.
    await client.query(
      "UPDATE otp_challenges SET consumed_at = NOW() WHERE phone_e164 = $1 AND consumed_at IS NULL",
      [phone],
    );

    await client.query(
      `INSERT INTO otp_challenges (phone_e164, otp_hmac, expires_at)
       VALUES ($1, $2, NOW() + ($3::integer * INTERVAL '1 second'))`,
      [phone, hashOtp(phone, code, config.otpHmacSecret), config.otpTtlSeconds],
    );

    await client.query("COMMIT");
    inTransaction = false;
  } catch (error: unknown) {
    if (inTransaction) {
      await safelyRollback(client);
    }
    throw error;
  } finally {
    client.release();
  }

  // Logging happens only after the challenge is safely committed.
  otpSender(phone, code);
  return { expiresInSeconds: config.otpTtlSeconds };
}

export async function verifyOtp(
  database: Pool,
  phone: string,
  submittedOtp: string,
  config: AuthConfig,
): Promise<VerifyOtpResult> {
  const client = await database.connect();
  let inTransaction = false;
  let user: AuthenticatedUser | null = null;

  try {
    await client.query("BEGIN");
    inTransaction = true;

    const challengeResult = await client.query(
      `SELECT id, otp_hmac
       FROM otp_challenges
       WHERE phone_e164 = $1 AND consumed_at IS NULL
       ORDER BY created_at DESC
       LIMIT 1`,
      [phone],
    );
    const challenge = challengeResult.rows[0] as { id: string; otp_hmac: string } | undefined;

    if (!challenge) {
      await client.query("COMMIT");
      inTransaction = false;
      throw invalidOtpError();
    }

    // Increment the attempt count atomically and only while the challenge is usable.
    const attemptResult = await client.query(
      `UPDATE otp_challenges
       SET attempts = attempts + 1
       WHERE id = $1
         AND consumed_at IS NULL
         AND expires_at > NOW()
         AND attempts < $2
       RETURNING attempts`,
      [challenge.id, config.otpMaxAttempts],
    );

    if (attemptResult.rowCount !== 1) {
      await client.query("COMMIT");
      inTransaction = false;
      throw invalidOtpError();
    }

    if (!safelyMatchesOtp(challenge.otp_hmac, phone, submittedOtp, config.otpHmacSecret)) {
      // Commit the increment even though the verification failed.
      await client.query("COMMIT");
      inTransaction = false;
      throw invalidOtpError();
    }

    // Only one concurrent request can consume this challenge and receive a token.
    const consumed = await client.query(
      `UPDATE otp_challenges
       SET consumed_at = NOW()
       WHERE id = $1 AND consumed_at IS NULL AND expires_at > NOW()
       RETURNING id`,
      [challenge.id],
    );

    if (consumed.rowCount !== 1) {
      await client.query("COMMIT");
      inTransaction = false;
      throw invalidOtpError();
    }

    const userResult = await client.query(
      `INSERT INTO users (phone_e164)
       VALUES ($1)
       ON CONFLICT (phone_e164)
       DO UPDATE SET phone_e164 = EXCLUDED.phone_e164
       RETURNING id::text AS id, phone_e164`,
      [phone],
    );

    const userRow = userResult.rows[0] as { id: string; phone_e164: string };
    user = { id: userRow.id, phone: userRow.phone_e164 };

    await client.query("COMMIT");
    inTransaction = false;
  } catch (error: unknown) {
    if (inTransaction) {
      await safelyRollback(client);
    }
    throw error;
  } finally {
    client.release();
  }

  if (!user) {
    // Defensive guard: success cannot proceed unless a user was committed.
    throw new Error("OTP verification completed without a user record.");
  }

  const token = jwt.sign(
    { phone: user.phone },
    config.jwtSecret,
    { algorithm: "HS256", subject: user.id, expiresIn: config.jwtTtlSeconds },
  );

  return { token, user, expiresInSeconds: config.jwtTtlSeconds };
}

async function safelyRollback(client: PoolClient): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } catch {
    // Preserve the original error; the connection will be released to the pool.
  }
}
