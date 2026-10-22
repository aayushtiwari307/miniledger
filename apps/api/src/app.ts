import express, { type Express, type NextFunction, type Request, type Response } from "express";
import type { Pool } from "pg";
import type { AuthConfig } from "./config/env";
import { createAuthRouter } from "./modules/auth/auth.routes";
import type { OtpSender } from "./modules/auth/otp";
import { createLoansRouter } from "./modules/loans/loans.routes";

export function createApp(database: Pool, authConfig: AuthConfig, otpSender?: OtpSender): Express {
  const app = express();

  app.disable("x-powered-by");
  app.use(express.json({ limit: "32kb" }));

  app.get("/api/health", async (_request: Request, response: Response) => {
    try {
      await database.query("SELECT 1");
      return response.status(200).json({
        status: "ok",
        service: "miniledger-api",
        database: "connected",
        timestamp: new Date().toISOString(),
      });
    } catch {
      // Keep implementation details and connection strings out of API responses.
      return response.status(503).json({
        status: "error",
        service: "miniledger-api",
        database: "unavailable",
      });
    }
  });

  app.use("/api/auth", createAuthRouter(database, authConfig, otpSender));
  app.use("/api", createLoansRouter(database, authConfig));

  app.use((_request: Request, response: Response) => {
    response.status(404).json({ error: { code: "NOT_FOUND", message: "Route not found" } });
  });

  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    // Express/body-parser exposes these stable error types for malformed or oversized JSON.
    // Return a client error instead of treating an invalid request as an internal server failure.
    const errorType = getErrorType(error);
    if (errorType === "entity.parse.failed") {
      return response.status(400).json({
        error: { code: "INVALID_JSON", message: "Request body must contain valid JSON." },
      });
    }
    if (errorType === "entity.too.large") {
      return response.status(413).json({
        error: { code: "PAYLOAD_TOO_LARGE", message: "Request body must not exceed 32 KB." },
      });
    }

    // Keep internal errors in the server only; never return SQL or secret details to clients.
    console.error("[MiniLedger API] request failed", error instanceof Error ? error.message : "Unknown error");
    return response.status(500).json({
      error: { code: "INTERNAL_ERROR", message: "Something went wrong. Please try again." },
    });
  });

  return app;
}

function getErrorType(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("type" in error)) return undefined;
  const type = (error as { type?: unknown }).type;
  return typeof type === "string" ? type : undefined;
}
