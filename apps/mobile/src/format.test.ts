import { describe, expect, it } from "vitest";
import { formatDate, formatMoney, formatRepaidDate, isRealDateOnly, normalizePhoneNumber } from "./format";

describe("mobile formatting helpers", () => {
  it("normalizes spaces and common punctuation in phone numbers", () => {
    expect(normalizePhoneNumber(" +91 98765-43210 ")).toBe("+919876543210");
    expect(normalizePhoneNumber("+1 (415) 555.0132")).toBe("+14155550132");
  });

  it("validates real date-only values", () => {
    expect(isRealDateOnly("2028-02-29")).toBe(true);
    expect(isRealDateOnly("2026-02-30")).toBe(false);
    expect(isRealDateOnly("2026-2-03")).toBe(false);
  });

  it("formats date-only values without timezone conversion", () => {
    expect(formatDate("2026-10-22")).toBe("22/10/2026");
  });

  it("formats repayment timestamps in Asia/Kolkata", () => {
    // 2026-10-21 20:00 UTC is already 2026-10-22 in India.
    expect(formatRepaidDate("2026-10-21T20:00:00.000Z")).toBe("22/10/2026");
    expect(formatRepaidDate("not-a-date")).toBe("recorded");
  });

  it("formats INR with two decimal places", () => {
    expect(formatMoney(0.3)).toBe("₹0.30");
  });
});
