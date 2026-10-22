import { Router, type Request, type Response, type NextFunction } from "express";
import type { Pool } from "pg";
import type { AuthConfig } from "../../config/env";
import { AuthServiceError, requestOtp, verifyOtp } from "./auth.service";
import { parseRequestOtpInput, parseVerifyOtpInput } from "./auth.schemas";
import { sendOtp, type OtpSender } from "./otp";

export function createAuthRouter(database: Pool, config: AuthConfig, otpSender: OtpSender = sendOtp): Router {
  const router = Router();

  router.post("/request-otp", async (request: Request, response: Response, next: NextFunction) => {
    const input = parseRequestOtpInput(request.body);
    if (!input) {
      return response.status(400).json({
        error: { code: "VALIDATION_ERROR", message: "Enter a valid phone number in international format, such as +919876543210." },
      });
    }

    try {
      const result = await requestOtp(database, input.phone, config, otpSender);
      return response.status(202).json({
        message: "Mock OTP requested. Check the server log for the code.",
        expiresInSeconds: result.expiresInSeconds,
      });
    } catch (error: unknown) {
      if (error instanceof AuthServiceError) return writeAuthError(response, error);
      return next(error);
    }
  });

  router.post("/verify-otp", async (request: Request, response: Response, next: NextFunction) => {
    const input = parseVerifyOtpInput(request.body);
    if (!input) {
      return response.status(400).json({
        error: { code: "VALIDATION_ERROR", message: "Enter a valid international phone number and a six-digit code." },
      });
    }

    try {
      const result = await verifyOtp(database, input.phone, input.otp, config);
      return response.status(200).json(result);
    } catch (error: unknown) {
      if (error instanceof AuthServiceError) return writeAuthError(response, error);
      return next(error);
    }
  });

  return router;
}

function writeAuthError(response: Response, error: AuthServiceError): Response {
  return response.status(error.status).json({
    error: { code: error.code, message: error.message },
  });
}
