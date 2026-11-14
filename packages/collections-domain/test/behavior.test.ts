import { describe, expect, it } from "vitest";
import { analyzePaymentBehavior, prioritizeWorklist, scoreRisk, slope, type Customer, type Invoice } from "../src";
import { FIXTURE_AS_OF, HERO_CUSTOMER_NO, fixtures } from "../src/fixtures";

const { customers, invoices } = fixtures;
const byName = (name: string) => customers.find((c) => c.name.startsWith(name))!;
const analyze = (name: string) => analyzePaymentBehavior(byName(name), invoices, FIXTURE_AS_OF);

describe("payment behaviour on the demo fixtures", () => {
  it("flags Fabrikam (hero) as high risk and worsening, with a 90+ balance", () => {
    const b = analyze("Fabrikam");
    expect(b.customerNo).toBe(HERO_CUSTOMER_NO);
    expect(b.trend).toBe("worsening");
    expect(b.riskLevel).toBe("high");
    expect(b.severeOverdueAmount).toBeGreaterThanOrEqual(48_500);
    expect(b.signals.join(" ")).toMatch(/Getting worse/);
    expect(b.monthly.length).toBeGreaterThan(6);
    expect(b.recentAvgDaysLate).toBeGreaterThan(b.priorAvgDaysLate);
  });

  it("recognises the chronic late payer", () => {
    const b = analyze("Northwind");
    expect(b.avgDaysLate).toBeGreaterThan(35);
    expect(b.trend).toBe("stable");
    expect(b.signals.join(" ")).toMatch(/days late/);
  });

  it("recognises the improving customer", () => {
    const b = analyze("Tailspin");
    expect(b.trend).toBe("improving");
    expect(b.trendDaysPerMonth).toBeLessThan(0);
    expect(b.riskLevel).toBe("low");
    expect(b.signals.join(" ")).toMatch(/Improving/);
  });

  it("scores punctual payers as low risk", () => {
    const b = analyze("Adventure Works");
    expect(b.riskLevel).toBe("low");
    expect(b.onTimeRate).toBeGreaterThan(0.5);
    expect(b.signals).toEqual(["No material risk signals"]);
  });

  it("handles a customer with no history", () => {
    const c: Customer = { ...byName("Fabrikam"), number: "C-NEW", creditLimit: 0 };
    const b = analyzePaymentBehavior(c, invoices, FIXTURE_AS_OF);
    expect(b.paidInvoiceCount).toBe(0);
    expect(b.onTimeRate).toBe(1);
    expect(b.creditUtilization).toBe(0);
    expect(b.riskScore).toBe(0);
  });

  it("flags over-limit customers", () => {
    const c = byName("Fabrikam");
    const b = analyzePaymentBehavior({ ...c, creditLimit: 10_000 }, invoices, FIXTURE_AS_OF);
    expect(b.creditUtilization).toBeGreaterThan(1);
    expect(b.signals.join(" ")).toMatch(/Over credit limit/);
  });
});

describe("scoring helpers", () => {
  it("computes a least-squares slope", () => {
    expect(slope([{ x: 0, y: 0 }, { x: 1, y: 2 }, { x: 2, y: 4 }])).toBeCloseTo(2);
    expect(slope([{ x: 0, y: 1 }, { x: 1, y: 1 }])).toBe(0);
    expect(slope([{ x: 1, y: 1 }, { x: 1, y: 2 }, { x: 1, y: 3 }])).toBe(0);
  });

  it("keeps the risk score within 0–100", () => {
    expect(scoreRisk({ weighted: 999, overdueAmount: 1e6, openAmount: 1, severeOverdueAmount: 1e6, trendDaysPerMonth: 99, creditUtilization: 9 })).toBe(100);
    expect(scoreRisk({ weighted: -30, overdueAmount: 0, openAmount: 0, severeOverdueAmount: 0, trendDaysPerMonth: -99, creditUtilization: 0 })).toBe(0);
  });
});

describe("worklist prioritisation", () => {
  it("puts Fabrikam's 90+ invoice first", () => {
    const list = prioritizeWorklist(customers, invoices, FIXTURE_AS_OF);
    expect(list[0]).toMatchObject({ rank: 1, customerNo: HERO_CUSTOMER_NO, remainingAmount: 48_500, critical: true, suggestedAction: "Call today" });
    expect(list[0]!.reasons).toContain("90+ days overdue");
    expect(list[0]!.reasons).toContain("Large balance");
    const scores = list.map((i) => i.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    expect(list.every((i) => i.daysOverdue >= 1)).toBe(true);
  });

  it("caps the number of critical items", () => {
    const list = prioritizeWorklist(customers, invoices, FIXTURE_AS_OF, { criticalScore: 0, maxCritical: 2 });
    expect(list.filter((i) => i.critical)).toHaveLength(2);
  });

  it("scopes to one customer and honours limit / minDaysOverdue", () => {
    const list = prioritizeWorklist(customers, invoices, FIXTURE_AS_OF, { customerNo: HERO_CUSTOMER_NO, limit: 2, minDaysOverdue: 30 });
    expect(list).toHaveLength(2);
    expect(list.every((i) => i.customerNo === HERO_CUSTOMER_NO && i.daysOverdue >= 30)).toBe(true);
    expect(prioritizeWorklist(customers, invoices, FIXTURE_AS_OF, { customerNo: "nope" })).toEqual([]);
  });

  it("explains low-signal items with their age and suggests monitoring", () => {
    const c: Customer = { id: "x", number: "C-X", name: "X", currency: "EUR", paymentTermsDays: 30, creditLimit: 1e6, salesperson: "JR" };
    const i: Invoice = { id: "y", number: "SI-X", customerId: "x", customerNumber: "C-X", customerName: "X", invoiceDate: "2026-10-01", dueDate: "2026-11-25", totalAmount: 10, remainingAmount: 10, currency: "EUR", status: "Open" };
    const [item] = prioritizeWorklist([c], [i], FIXTURE_AS_OF);
    expect(item).toMatchObject({ reasons: ["2 days overdue"], suggestedAction: "Monitor" });
  });
});
