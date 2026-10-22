const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Normalize common human formatting while preserving E.164's leading plus sign. */
export function normalizePhoneNumber(value: string): string {
  return value.replace(/[\s().-]/g, "").trim();
}

export function isRealDateOnly(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1000 || month < 1 || month > 12 || day < 1) return false;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= daysInMonth;
}

export function formatMoney(value: number): string {
  return `₹${value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Display a date-only value without converting it through UTC/local timezone. */
export function formatDate(value: string): string {
  const match = value.match(DATE_PATTERN);
  if (!match) return value;
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

/** `repaidAt` is a UTC ISO timestamp; display the calendar day in the app's India timezone. */
export function formatRepaidDate(value: string): string {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return "recorded";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(parsed);
}
