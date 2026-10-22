import jwt from "jsonwebtoken";
import type { NextFunction, Request, Response } from "express";
import type { AuthConfig } from "../config/env";

export interface AuthenticatedRequest extends Request {
  user?: { id: string; phone: string };
}

export function requireAuth(config: AuthConfig) {
  return (request: Request, response: Response, next: NextFunction): void => {
    const authorization = request.get("authorization");
    const match = authorization?.match(/^Bearer\s+([^\s]+)$/i);
    if (!match) {
      writeUnauthorized(response);
      return;
    }

    try {
      const decoded = jwt.verify(match[1], config.jwtSecret, { algorithms: ["HS256"] });
      if (
        typeof decoded === "string" ||
        typeof decoded.sub !== "string" ||
        typeof decoded.phone !== "string"
      ) {
        writeUnauthorized(response);
        return;
      }

      (request as AuthenticatedRequest).user = { id: decoded.sub, phone: decoded.phone };
      next();
    } catch {
      writeUnauthorized(response);
    }
  };
}

function writeUnauthorized(response: Response): void {
  response.status(401).json({
    error: { code: "UNAUTHORIZED", message: "Please log in to continue." },
  });
}
