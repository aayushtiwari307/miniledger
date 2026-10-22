import { describe, expect, it } from "vitest";
import { isValidDateOnly, isValidUuid, parseCreateLoanInput } from "./modules/loans/loan.schemas";

describe("loan input validation", () => {
  it("accepts a valid loan and rounds only floating-point noise to cents", () => {
    expect(parseCreateLoanInput({ friendName: "  Sam  ", amount: 1.15, dueDate: "2026-10-22" })).toEqual({
      friendName: "Sam",
      amount: 1.15,
      dueDate: "2026-10-22",
    });
  });

  it.each([
    ["zero amount", { friendName: "Sam", amount: 0, dueDate: "2026-10-22" }],
    ["negative amount", { friendName: "Sam", amount: -1, dueDate: "2026-10-22" }],
    ["three decimal places", { friendName: "Sam", amount: 1.234, dueDate: "2026-10-22" }],
    ["half-cent amount", { friendName: "Sam", amount: 0.005, dueDate: "2026-10-22" }],
    ["tiny scientific-notation amount", { friendName: "Sam", amount: 1e-7, dueDate: "2026-10-22" }],
    ["too-large amount", { friendName: "Sam", amount: 100_000_000, dueDate: "2026-10-22" }],
    ["blank friend name", { friendName: "   ", amount: 1, dueDate: "2026-10-22" }],
    ["friend name over 80 characters", { friendName: "x".repeat(81), amount: 1, dueDate: "2026-10-22" }],
    ["invalid calendar date", { friendName: "Sam", amount: 1, dueDate: "2026-02-30" }],
    ["non-date format", { friendName: "Sam", amount: 1, dueDate: "22-10-2026" }],
    ["string amount", { friendName: "Sam", amount: "1.15", dueDate: "2026-10-22" }],
  ])("rejects %s", (_label, input) => {
    expect(parseCreateLoanInput(input)).toBeNull();
  });

  it("accepts decimal and scientific-notation values when they represent valid cents", () => {
    expect(parseCreateLoanInput({ friendName: "Sam", amount: 1.15, dueDate: "2026-10-22" })?.amount).toBe(1.15);
    expect(parseCreateLoanInput({ friendName: "Sam", amount: 1e2, dueDate: "2026-10-22" })?.amount).toBe(100);
  });

  it("accepts the documented maximum amount without a floating-point false rejection", () => {
    expect(parseCreateLoanInput({ friendName: "Sam", amount: 99_999_999.99, dueDate: "2026-10-22" })?.amount).toBe(99_999_999.99);
  });

  it("counts friend-name Unicode code points consistently with PostgreSQL character length", () => {
    expect(parseCreateLoanInput({ friendName: "😀".repeat(80), amount: 1, dueDate: "2026-10-22" })?.friendName).toBe("😀".repeat(80));
    expect(parseCreateLoanInput({ friendName: "😀".repeat(81), amount: 1, dueDate: "2026-10-22" })).toBeNull();
  });

  it("validates leap years and UUID path parameters", () => {
    expect(isValidDateOnly("2028-02-29")).toBe(true);
    expect(isValidDateOnly("2027-02-29")).toBe(false);
    expect(isValidUuid("a0d45bf7-88c0-42b9-8f1a-8f31a5a60001")).toBe(true);
    expect(isValidUuid("not-a-uuid")).toBe(false);
  });
});
