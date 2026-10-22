import type { Pool } from "pg";

export type LoanStatus = "outstanding" | "overdue" | "repaid";

interface LoanRow {
  id: string;
  friend_name: string;
  amount: string | number;
  due_date: string;
  created_at: Date | string;
  repaid_at: Date | string | null;
}

export interface LoanDto {
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

/** Returns today's calendar date in the app's business timezone, independent of the DB and device timezone. */
export function getIndiaBusinessDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export async function listLoans(database: Pool, userId: string): Promise<LoanDto[]> {
  const result = await database.query<LoanRow>(
    `SELECT id::text AS id,
            friend_name,
            amount::text AS amount,
            due_date::text AS due_date,
            created_at,
            repaid_at
     FROM loans
     WHERE user_id = $1
     ORDER BY created_at DESC, id DESC`,
    [userId],
  );
  const businessDate = getIndiaBusinessDate();
  return result.rows.map((row) => mapLoan(row, businessDate));
}

export async function createLoan(
  database: Pool,
  userId: string,
  input: { friendName: string; amount: number; dueDate: string },
): Promise<LoanDto> {
  const result = await database.query<LoanRow>(
    `INSERT INTO loans (user_id, friend_name, amount, due_date)
     VALUES ($1, $2, $3::numeric(12, 2), $4::date)
     RETURNING id::text AS id,
               friend_name,
               amount::text AS amount,
               due_date::text AS due_date,
               created_at,
               repaid_at`,
    [userId, input.friendName, input.amount.toFixed(2), input.dueDate],
  );
  return mapLoan(result.rows[0], getIndiaBusinessDate());
}

export class RepayLoanError extends Error {
  constructor(public readonly status: 404 | 409, public readonly code: "LOAN_NOT_FOUND" | "ALREADY_REPAID", message: string) {
    super(message);
    this.name = "RepayLoanError";
  }
}

export async function repayLoan(database: Pool, userId: string, loanId: string): Promise<LoanDto> {
  // One statement avoids a check-then-update race when two requests repay the same loan.
  const updated = await database.query<LoanRow>(
    `UPDATE loans
     SET repaid_at = NOW()
     WHERE id = $1 AND user_id = $2 AND repaid_at IS NULL
     RETURNING id::text AS id,
               friend_name,
               amount::text AS amount,
               due_date::text AS due_date,
               created_at,
               repaid_at`,
    [loanId, userId],
  );

  if (updated.rowCount === 1) {
    return mapLoan(updated.rows[0], getIndiaBusinessDate());
  }

  // Distinguish a known, already-repaid loan from a missing or other user's loan.
  const existing = await database.query<{ repaid_at: Date | string | null }>(
    "SELECT repaid_at FROM loans WHERE id = $1 AND user_id = $2",
    [loanId, userId],
  );
  if (existing.rowCount === 0) {
    throw new RepayLoanError(404, "LOAN_NOT_FOUND", "Loan not found.");
  }
  throw new RepayLoanError(409, "ALREADY_REPAID", "This loan has already been marked as repaid.");
}

export async function getSummary(database: Pool, userId: string): Promise<LedgerSummary> {
  const businessDate = getIndiaBusinessDate();
  const result = await database.query<{
    total_lent: string | number;
    total_repaid: string | number;
    overdue_amount: string | number;
  }>(
    `SELECT
       COALESCE(SUM(amount), 0)::text AS total_lent,
       COALESCE(SUM(amount) FILTER (WHERE repaid_at IS NOT NULL), 0)::text AS total_repaid,
       COALESCE(SUM(amount) FILTER (WHERE repaid_at IS NULL AND due_date < $2::date), 0)::text AS overdue_amount
     FROM loans
     WHERE user_id = $1`,
    [userId, businessDate],
  );

  const row = result.rows[0];
  // pg returns NUMERIC as text by default; convert once at the JSON/API boundary.
  return {
    totalLent: Number(row.total_lent),
    totalRepaid: Number(row.total_repaid),
    overdueAmount: Number(row.overdue_amount),
  };
}

function mapLoan(row: LoanRow, businessDate: string): LoanDto {
  const dueDate = row.due_date;
  const repaidAt = row.repaid_at === null ? null : asIsoTimestamp(row.repaid_at);
  let status: LoanStatus;
  if (repaidAt !== null) status = "repaid";
  else if (dueDate < businessDate) status = "overdue";
  else status = "outstanding";

  return {
    id: row.id,
    friendName: row.friend_name,
    amount: Number(row.amount),
    dueDate,
    createdAt: asIsoTimestamp(row.created_at),
    repaidAt,
    status,
  };
}

function asIsoTimestamp(value: Date | string): string {
  const parsed = value instanceof Date ? value : new Date(value);
  return parsed.toISOString();
}
