import { describe, expect, it } from "vitest";
import { getIndiaBusinessDate } from "./modules/loans/loan.service";

describe("India business date", () => {
  it("uses Asia/Kolkata rather than the process or database UTC date", () => {
    // 20:00 UTC is already 01:30 on the next day in India.
    expect(getIndiaBusinessDate(new Date("2026-10-20T20:00:00.000Z"))).toBe("2026-10-21");
  });

  it("changes date at midnight in India, not midnight UTC", () => {
    expect(getIndiaBusinessDate(new Date("2026-10-21T18:29:59.000Z"))).toBe("2026-10-21");
    expect(getIndiaBusinessDate(new Date("2026-10-21T18:30:00.000Z"))).toBe("2026-10-22");
  });
});
