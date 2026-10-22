import { Router, type NextFunction, type Request, type Response } from "express";
import type { Pool } from "pg";
import type { AuthConfig } from "../../config/env";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/auth";
import { createLoan, getSummary, listLoans, repayLoan, RepayLoanError } from "./loan.service";
import { isValidUuid, parseCreateLoanInput } from "./loan.schemas";

export function createLoansRouter(database: Pool, config: AuthConfig): Router {
  const router = Router();
  router.get("/loans", requireAuth(config), async (request: Request, response: Response, next: NextFunction) => {
    try {
      const userId = getUserId(request);
      const loans = await listLoans(database, userId);
      return response.status(200).json({ loans });
    } catch (error: unknown) {
      return next(error);
    }
  });

  router.post("/loans", requireAuth(config), async (request: Request, response: Response, next: NextFunction) => {
    const input = parseCreateLoanInput(request.body);
    if (!input) {
      return response.status(400).json({
        error: {
          code: "VALIDATION_ERROR",
          message: "Provide a friend name (1–80 characters), a positive amount with at most two decimal places, and a real YYYY-MM-DD due date.",
        },
      });
    }

    try {
      const loan = await createLoan(database, getUserId(request), input);
      return response.status(201).json({ loan });
    } catch (error: unknown) {
      return next(error);
    }
  });

  router.post("/loans/:id/repay", requireAuth(config), async (request: Request, response: Response, next: NextFunction) => {
    const loanId = request.params.id;
    if (typeof loanId !== "string" || !isValidUuid(loanId)) {
      return response.status(400).json({
        error: { code: "VALIDATION_ERROR", message: "Loan ID must be a valid UUID." },
      });
    }

    try {
      const loan = await repayLoan(database, getUserId(request), loanId);
      return response.status(200).json({ loan });
    } catch (error: unknown) {
      if (error instanceof RepayLoanError) {
        return response.status(error.status).json({
          error: { code: error.code, message: error.message },
        });
      }
      return next(error);
    }
  });

  router.get("/summary", requireAuth(config), async (request: Request, response: Response, next: NextFunction) => {
    try {
      const summary = await getSummary(database, getUserId(request));
      return response.status(200).json({ summary });
    } catch (error: unknown) {
      return next(error);
    }
  });

  return router;
}

function getUserId(request: Request): string {
  const authenticated = request as AuthenticatedRequest;
  if (!authenticated.user) {
    // requireAuth is mounted before the handlers, so this indicates a programming error.
    throw new Error("Authenticated user was missing after requireAuth middleware.");
  }
  return authenticated.user.id;
}
