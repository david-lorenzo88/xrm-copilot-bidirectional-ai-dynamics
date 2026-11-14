import { describe, expect, it } from "vitest";
import { DEFAULT_AGING_BUCKETS } from "@collections/contract";
import { addDays, ageInvoices, bucketFor, daysBetween, daysOverdue, formatIsoDate, monthKey, monthsBetween, openInvoices, summarizeAging, toUtcDay, type Invoice } from "../src";

const inv = (over: Partial<Invoice>): Invoice => ({
  id: "0f8fad5b-d9cb-469f-a165-70867728950e",
  number: "SI-1",
  customerId: "c1",
  customerNumber: "C-1",
  customerName: "Test",
  invoiceDate: "2026-09-01",
  dueDate: "2026-10-01",
  totalAmount: 100,
  remainingAmount: 100,
  currency: "EUR",
  status: "Open",
  ...over,
});

describe("dates", () => {
  it("does whole-day UTC arithmetic", () => {
    expect(daysBetween("2026-11-01", "2026-11-27")).toBe(26);
    expect(daysBetween("2026-11-27", "2026-11-01")).toBe(-26);
    expect(daysBetween("2026-03-28", "2026-03-30")).toBe(2); // across DST
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
    expect(formatIsoDate(new Date("2026-11-27T23:59:00Z"))).toBe("2026-11-27");
    expect(toUtcDay(new Date("2026-11-27T10:00:00Z"))).toBe(toUtcDay("2026-11-27"));
    expect(toUtcDay("2026-11-27T10:00:00Z")).toBe(toUtcDay("2026-11-27"));
    expect(monthKey("2026-11-27")).toBe("2026-11");
    expect(monthsBetween("2026-01-01", "2026-12-31")).toBeCloseTo(11.96, 1);
    expect(() => toUtcDay("not a date")).toThrow(RangeError);
  });
});

describe("aging buckets", () => {
  it.each([
    [0, "current"],
    [1, "1-30"],
    [30, "1-30"],
    [31, "31-60"],
    [60, "31-60"],
    [61, "61-90"],
    [90, "61-90"],
    [91, "90+"],
    [400, "90+"],
  ])("%i days → %s", (days, id) => {
    expect(bucketFor(days).id).toBe(id);
  });

  it("throws when no bucket covers the value", () => {
    expect(() => bucketFor(5, [{ id: "x", label: "x", minDays: 10, maxDays: 20 }])).toThrow(RangeError);
  });

  it("computes days overdue, never negative", () => {
    expect(daysOverdue("2026-11-30", "2026-11-27")).toBe(0);
    expect(daysOverdue("2026-08-19", "2026-11-27")).toBe(100);
  });
});

describe("open invoices and summary", () => {
  const asOf = "2026-11-27";
  const invoices = [
    inv({ number: "A", dueDate: "2026-12-10" }), // current
    inv({ number: "B", dueDate: "2026-11-10", remainingAmount: 50 }), // 17 days
    inv({ number: "C", dueDate: "2026-08-19", remainingAmount: 48_500 }), // 100 days
    inv({ number: "D", remainingAmount: 0, status: "Paid" }),
    inv({ number: "E", status: "Canceled" }),
    inv({ number: "F", invoiceDate: "2026-12-01", dueDate: "2026-12-31" }), // future
  ];

  it("filters to open, non-canceled, already-issued invoices", () => {
    expect(openInvoices(invoices, asOf).map((i) => i.number)).toEqual(["A", "B", "C"]);
  });

  it("ages invoices into buckets", () => {
    expect(ageInvoices(invoices, asOf).map((i) => [i.number, i.daysOverdue, i.bucketId])).toEqual([
      ["A", 0, "current"],
      ["B", 17, "1-30"],
      ["C", 100, "90+"],
    ]);
  });

  it("summarises totals per bucket", () => {
    const s = summarizeAging(invoices, asOf, DEFAULT_AGING_BUCKETS);
    expect(s.openAmount).toBe(48_650);
    expect(s.overdueAmount).toBe(48_550);
    expect(s.overdueCount).toBe(2);
    expect(s.oldestDaysOverdue).toBe(100);
    expect(s.buckets.find((b) => b.id === "90+")).toMatchObject({ amount: 48_500, count: 1 });
    expect(summarizeAging([], asOf).oldestDaysOverdue).toBe(0);
  });
});
