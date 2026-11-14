import { ageInvoices, round2 } from "./aging";
import { analyzePaymentBehavior, type PaymentBehavior } from "./payment-behavior";
import type { Customer, Invoice } from "./types";

export type SuggestedAction = "Call today" | "Send reminder" | "Monitor";

export interface WorklistItem {
  rank: number;
  invoiceId: string;
  invoiceNo: string;
  customerId: string;
  customerNo: string;
  customerName: string;
  dueDate: string;
  daysOverdue: number;
  bucketId: string;
  remainingAmount: number;
  currency: string;
  customerRiskScore: number;
  score: number;
  critical: boolean;
  suggestedAction: SuggestedAction;
  reasons: string[];
}

export interface PrioritizeOptions {
  /** Limit to one customer (e.g. the record open in the app). */
  customerNo?: string;
  minDaysOverdue?: number;
  limit?: number;
  /** Score at/above which an item is "critical" (opened in side panes). */
  criticalScore?: number;
  maxCritical?: number;
}

export const DEFAULT_CRITICAL_SCORE = 65;
/** Balance (in invoice currency) from which "Large balance" is called out. */
export const LARGE_BALANCE = 10_000;

/**
 * Ranks overdue invoices for today's chase list.
 * score = 35 × size (log-scaled vs the largest) + 35 × age (capped at 120 days) + 30 × customer risk.
 */
export function prioritizeWorklist(
  customers: readonly Customer[],
  invoices: readonly Invoice[],
  asOf: string,
  options: PrioritizeOptions = {},
): WorklistItem[] {
  const { customerNo, minDaysOverdue = 1, limit = 20, criticalScore = DEFAULT_CRITICAL_SCORE, maxCritical = 3 } = options;
  const scope = customerNo ? customers.filter((c) => c.number === customerNo) : customers;
  const behavior = new Map<string, PaymentBehavior>(scope.map((c) => [c.number, analyzePaymentBehavior(c, invoices, asOf)]));

  const overdue = ageInvoices(invoices, asOf).filter((i) => behavior.has(i.customerNumber) && i.daysOverdue >= minDaysOverdue);
  const maxAmount = Math.max(1, ...overdue.map((i) => i.remainingAmount));

  const scored = overdue.map((inv) => {
    const b = behavior.get(inv.customerNumber)!;
    const size = Math.log1p(inv.remainingAmount) / Math.log1p(maxAmount);
    const age = Math.min(inv.daysOverdue, 120) / 120;
    const score = Math.round(35 * size + 35 * age + 30 * (b.riskScore / 100));
    const reasons: string[] = [];
    if (inv.daysOverdue > 90) reasons.push("90+ days overdue");
    else if (inv.daysOverdue > 60) reasons.push("61–90 days overdue");
    if (inv.remainingAmount >= LARGE_BALANCE) reasons.push("Large balance");
    if (b.riskLevel === "high") reasons.push("High-risk customer");
    if (b.trend === "worsening") reasons.push("Payment behaviour worsening");
    if (reasons.length === 0) reasons.push(`${inv.daysOverdue} days overdue`);
    return { inv, b, score, reasons };
  });

  scored.sort((a, b) => b.score - a.score || b.inv.remainingAmount - a.inv.remainingAmount || a.inv.number.localeCompare(b.inv.number));

  let criticalCount = 0;
  return scored.slice(0, limit).map(({ inv, b, score, reasons }, idx) => {
    const critical = score >= criticalScore && criticalCount < maxCritical;
    if (critical) criticalCount += 1;
    return {
      rank: idx + 1,
      invoiceId: inv.id,
      invoiceNo: inv.number,
      customerId: inv.customerId,
      customerNo: inv.customerNumber,
      customerName: inv.customerName,
      dueDate: inv.dueDate,
      daysOverdue: inv.daysOverdue,
      bucketId: inv.bucketId,
      remainingAmount: round2(inv.remainingAmount),
      currency: inv.currency,
      customerRiskScore: b.riskScore,
      score,
      critical,
      suggestedAction: score >= criticalScore ? "Call today" : score >= 45 ? "Send reminder" : "Monitor",
      reasons,
    };
  });
}

/**
 * Builds worklist rows for invoices in an order someone else decided (the agent's
 * ShowWorklist payload). Used in-app, where the full scoring inputs aren't loaded:
 * rank follows `order`, the rest is derived from aging.
 */
export function rankedWorklist(
  invoices: readonly Invoice[],
  order: readonly string[],
  asOf: string,
  suggested: readonly SuggestedAction[] = [],
): WorklistItem[] {
  const position = new Map(order.map((id, i) => [id, i]));
  return ageInvoices(invoices, asOf)
    .sort((a, b) => (position.get(a.id) ?? Infinity) - (position.get(b.id) ?? Infinity) || b.daysOverdue - a.daysOverdue)
    .map((inv, idx) => ({
      rank: idx + 1,
      invoiceId: inv.id,
      invoiceNo: inv.number,
      customerId: inv.customerId,
      customerNo: inv.customerNumber,
      customerName: inv.customerName,
      dueDate: inv.dueDate,
      daysOverdue: inv.daysOverdue,
      bucketId: inv.bucketId,
      remainingAmount: round2(inv.remainingAmount),
      currency: inv.currency,
      customerRiskScore: 0,
      score: 0,
      critical: false,
      suggestedAction: suggested[position.get(inv.id) ?? -1] ?? (inv.daysOverdue > 60 ? "Call today" : inv.daysOverdue > 0 ? "Send reminder" : "Monitor"),
      reasons: [inv.daysOverdue > 90 ? "90+ days overdue" : `${inv.daysOverdue} days overdue`],
    }));
}
