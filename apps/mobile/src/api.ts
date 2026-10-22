export interface AuthUser {
  id: string;
  phone: string;
}

export interface VerifyOtpResponse {
  token: string;
  user: AuthUser;
  expiresInSeconds: number;
}

export type LoanStatus = "outstanding" | "overdue" | "repaid";

export interface Loan {
  id: string;
  friendName: string;
  amount: number;
  dueDate: string;
  createdAt: string;
  repaidAt: string | null;
  status: LoanStatus;
}

export interface LedgerSummary {
  totalLent: number;
  totalRepaid: number;
  overdueAmount: number;
}

export class ApiError extends Error {
  constructor(message: string, public readonly status: number, public readonly code?: string) {
    super(message);
    this.name = "ApiError";
  }
}

const REQUEST_TIMEOUT_MS = 10_000;
const configuredBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://10.0.2.2:3001";
export const API_BASE_URL = configuredBaseUrl.replace(/\/+$/, "");

export async function requestOtp(phone: string): Promise<{ expiresInSeconds: number }> {
  return request("/api/auth/request-otp", {
    method: "POST",
    body: JSON.stringify({ phone }),
  });
}

export async function verifyOtp(phone: string, otp: string): Promise<VerifyOtpResponse> {
  return request("/api/auth/verify-otp", {
    method: "POST",
    body: JSON.stringify({ phone, otp }),
  });
}

export async function fetchLoans(token: string): Promise<Loan[]> {
  const payload = await request<{ loans: Loan[] }>("/api/loans", { method: "GET" }, token);
  return payload.loans;
}

export async function fetchSummary(token: string): Promise<LedgerSummary> {
  const payload = await request<{ summary: LedgerSummary }>("/api/summary", { method: "GET" }, token);
  return payload.summary;
}

export async function addLoan(
  token: string,
  input: { friendName: string; amount: number; dueDate: string },
): Promise<Loan> {
  const payload = await request<{ loan: Loan }>(
    "/api/loans",
    { method: "POST", body: JSON.stringify(input) },
    token,
  );
  return payload.loan;
}

export async function markLoanRepaid(token: string, loanId: string): Promise<Loan> {
  const payload = await request<{ loan: Loan }>(
    `/api/loans/${encodeURIComponent(loanId)}/repay`,
    { method: "POST" },
    token,
  );
  return payload.loan;
}

async function request<T>(path: string, init: RequestInit, token?: string): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body !== undefined) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);

  let response: Response;
  let payload: unknown = null;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    response = await fetch(`${API_BASE_URL}${path}`, { ...init, headers, signal: controller.signal });
    try {
      payload = await response.json();
    } catch (error: unknown) {
      if (controller.signal.aborted) throw error;
      // Some intermediary errors return an empty or non-JSON body; the HTTP status is still useful.
      payload = null;
    }
  } catch (error: unknown) {
    if (controller.signal.aborted) {
      throw new Error(`MiniLedger API request timed out after ${REQUEST_TIMEOUT_MS / 1000} seconds. Check the server and mobile base URL.`);
    }
    throw new Error(`Cannot reach MiniLedger API at ${API_BASE_URL}. Check the server and mobile base URL.`);
  } finally {
    clearTimeout(timeoutId);
  }
  if (!response.ok) {
    let message = `The API returned HTTP ${response.status}.`;
    let code: string | undefined;
    if (isRecord(payload) && isRecord(payload.error)) {
      if (typeof payload.error.message === "string") message = payload.error.message;
      if (typeof payload.error.code === "string") code = payload.error.code;
    }
    throw new ApiError(message, response.status, code);
  }

  if (payload === null || typeof payload !== "object") {
    throw new Error("The API returned an invalid response.");
  }
  return payload as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
