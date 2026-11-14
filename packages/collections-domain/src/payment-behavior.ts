import { ageInvoices, round2, sum } from "./aging";
import { addDays, daysBetween, monthKey, monthsBetween } from "./dates";
import type { Customer, Invoice } from "./types";

export type Trend = "improving" | "stable" | "worsening";
export type RiskLevel = "low" | "medium" | "high";

export interface PaymentBehavior {
  customerNo: string;
  customerName: string;
  currency: string;
  asOf: string;
  lookbackMonths: number;
  paidInvoiceCount: number;
  /** Mean days between due date and payment (negative = early). */
  avgDaysLate: number;
  /** Amount-weighted mean, so one large late invoice counts for more. */
  weightedAvgDaysLate: number;
  onTimeRate: number;
  recentAvgDaysLate: number;
  priorAvgDaysLate: number;
  trend: Trend;
  /** Linear-regression slope of days late over time. */
  trendDaysPerMonth: number;
  openAmount: number;
  overdueAmount: number;
  severeOverdueAmount: number;
  creditUtilization: number;
  riskScore: number;
  riskLevel: RiskLevel;
  monthly: { month: string; avgDaysLate: number; invoices: number }[];
  signals: string[];
}

export interface PaymentBehaviorOptions {
  lookbackMonths?: number;
  /** Window (months) treated as "recent" for the recent vs prior comparison. */
  recentMonths?: number;
}

/** Slope (|days/month|) below which we call the trend stable. */
export const TREND_THRESHOLD = 1.5;
/** Days overdue from which an open balance counts as severe. */
export const SEVERE_DAYS = 61;

interface Observation {
  dueDate: string;
  daysLate: number;
  amount: number;
}

/**
 * Days-late observations: paid invoices give their actual lateness; open
 * overdue invoices give a lower bound (days overdue so far). Including the
 * open ones stops a customer who simply stopped paying from looking "stable".
 */
function observations(invoices: readonly Invoice[], asOf: string, since: string): Observation[] {
  return invoices
    .filter((i) => i.status !== "Canceled" && i.dueDate >= since && i.dueDate <= asOf)
    .flatMap((i): Observation[] => {
      if (i.closedDate && i.remainingAmount === 0) {
        return [{ dueDate: i.dueDate, daysLate: daysBetween(i.dueDate, i.closedDate), amount: i.totalAmount }];
      }
      const overdue = daysBetween(i.dueDate, asOf);
      return overdue > 0 ? [{ dueDate: i.dueDate, daysLate: overdue, amount: i.remainingAmount }] : [];
    });
}

/** Least-squares slope of y over x. Returns 0 for fewer than 3 points. */
export function slope(points: readonly { x: number; y: number }[]): number {
  if (points.length < 3) return 0;
  const n = points.length;
  const mx = sum(points.map((p) => p.x)) / n;
  const my = sum(points.map((p) => p.y)) / n;
  const num = sum(points.map((p) => (p.x - mx) * (p.y - my)));
  const den = sum(points.map((p) => (p.x - mx) ** 2));
  return den === 0 ? 0 : num / den;
}

const mean = (xs: readonly number[]) => (xs.length ? sum(xs) / xs.length : 0);
const clamp = (n: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, n));

export function analyzePaymentBehavior(
  customer: Customer,
  invoices: readonly Invoice[],
  asOf: string,
  options: PaymentBehaviorOptions = {},
): PaymentBehavior {
  const lookbackMonths = options.lookbackMonths ?? 12;
  const recentMonths = options.recentMonths ?? 3;
  const mine = invoices.filter((i) => i.customerNumber === customer.number);
  const since = addDays(asOf, -Math.round(lookbackMonths * 30.44));
  const recentSince = addDays(asOf, -Math.round(recentMonths * 30.44));

  const obs = observations(mine, asOf, since);
  const lateness = obs.map((o) => o.daysLate);
  const totalWeight = sum(obs.map((o) => o.amount));
  const weighted = totalWeight ? sum(obs.map((o) => o.daysLate * o.amount)) / totalWeight : 0;
  const trendDaysPerMonth = slope(obs.map((o) => ({ x: monthsBetween(since, o.dueDate), y: o.daysLate })));
  const trend: Trend = trendDaysPerMonth > TREND_THRESHOLD ? "worsening" : trendDaysPerMonth < -TREND_THRESHOLD ? "improving" : "stable";

  const aged = ageInvoices(mine, asOf);
  const openAmount = round2(sum(aged.map((i) => i.remainingAmount)));
  const overdueAmount = round2(sum(aged.filter((i) => i.daysOverdue > 0).map((i) => i.remainingAmount)));
  const severeOverdueAmount = round2(sum(aged.filter((i) => i.daysOverdue >= SEVERE_DAYS).map((i) => i.remainingAmount)));
  const creditUtilization = customer.creditLimit > 0 ? round2(openAmount / customer.creditLimit) : 0;

  const riskScore = scoreRisk({ weighted, overdueAmount, openAmount, severeOverdueAmount, trendDaysPerMonth, creditUtilization });
  const riskLevel: RiskLevel = riskScore >= 60 ? "high" : riskScore >= 35 ? "medium" : "low";

  const byMonth = new Map<string, number[]>();
  for (const o of obs) byMonth.set(monthKey(o.dueDate), [...(byMonth.get(monthKey(o.dueDate)) ?? []), o.daysLate]);
  const monthly = [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, xs]) => ({ month, avgDaysLate: round1(mean(xs)), invoices: xs.length }));

  const recent = obs.filter((o) => o.dueDate >= recentSince).map((o) => o.daysLate);
  const prior = obs.filter((o) => o.dueDate < recentSince).map((o) => o.daysLate);

  const result: PaymentBehavior = {
    customerNo: customer.number,
    customerName: customer.name,
    currency: customer.currency,
    asOf,
    lookbackMonths,
    paidInvoiceCount: mine.filter((i) => i.closedDate && i.dueDate >= since).length,
    avgDaysLate: round1(mean(lateness)),
    weightedAvgDaysLate: round1(weighted),
    onTimeRate: obs.length ? round2(obs.filter((o) => o.daysLate <= 0).length / obs.length) : 1,
    recentAvgDaysLate: round1(mean(recent)),
    priorAvgDaysLate: round1(mean(prior)),
    trend,
    trendDaysPerMonth: round1(trendDaysPerMonth),
    openAmount,
    overdueAmount,
    severeOverdueAmount,
    creditUtilization,
    riskScore,
    riskLevel,
    monthly,
    signals: [],
  };
  result.signals = explainSignals(result);
  return result;
}

interface RiskInputs {
  weighted: number;
  overdueAmount: number;
  openAmount: number;
  severeOverdueAmount: number;
  trendDaysPerMonth: number;
  creditUtilization: number;
}

/**
 * Risk score 0–100. Weights: lateness 35, overdue share 15, severe aging 20,
 * trend ±15, credit utilisation 15. Deliberately simple and explainable.
 */
export function scoreRisk(r: RiskInputs): number {
  const open = Math.max(r.openAmount, 1);
  const score =
    clamp(r.weighted / 60) * 35 +
    clamp(r.overdueAmount / open) * 15 +
    clamp(r.severeOverdueAmount / open) * 20 +
    clamp(r.trendDaysPerMonth / 6, -1, 1) * 15 +
    clamp(r.creditUtilization / 1.5) * 15;
  return Math.round(clamp(score, 0, 100));
}

function explainSignals(b: PaymentBehavior): string[] {
  const s: string[] = [];
  if (b.weightedAvgDaysLate >= 30) s.push(`Pays on average ${Math.round(b.weightedAvgDaysLate)} days late`);
  if (b.trend === "worsening") s.push(`Getting worse: +${b.trendDaysPerMonth} days late per month`);
  if (b.trend === "improving") s.push(`Improving: ${b.trendDaysPerMonth} days late per month`);
  if (b.severeOverdueAmount > 0) s.push(`${b.currency} ${b.severeOverdueAmount.toFixed(2)} is more than ${SEVERE_DAYS - 1} days overdue`);
  if (b.creditUtilization > 1) s.push(`Over credit limit (${Math.round(b.creditUtilization * 100)}%)`);
  if (s.length === 0) s.push("No material risk signals");
  return s;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
