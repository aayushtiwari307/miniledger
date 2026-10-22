export interface CreateLoanInput {
  friendName: string;
  amount: number;
  dueDate: string;
}

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// Keep the JS decimal validation in a range where binary floating-point cents are reliable.
const MAX_AMOUNT = 99_999_999.99;

export function parseCreateLoanInput(value: unknown): CreateLoanInput | null {
  if (!isRecord(value)) return null;
  if (typeof value.friendName !== "string" || typeof value.amount !== "number" || typeof value.dueDate !== "string") {
    return null;
  }

  const friendName = value.friendName.trim();
  const amount = value.amount;
  const dueDate = value.dueDate.trim();

  const friendNameCodePoints = Array.from(friendName).length;
  if (friendNameCodePoints < 1 || friendNameCodePoints > 80) return null;
  if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_AMOUNT) return null;
  // Avoid rejecting valid values such as 1.15 due to binary floating-point representation.
  if (Math.abs(amount * 100 - Math.round(amount * 100)) >= 1e-6) return null;
  if (!isValidDateOnly(dueDate)) return null;

  return { friendName, amount: Math.round(amount * 100) / 100, dueDate };
}

export function isValidUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

export function isValidDateOnly(value: string): boolean {
  if (!DATE_ONLY_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1000 || month < 1 || month > 12 || day < 1) return false;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= daysInMonth;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
