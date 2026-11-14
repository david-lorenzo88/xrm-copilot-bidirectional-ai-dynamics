import { DEFAULT_AGING_BUCKETS, type AgingBucket } from "@collections/contract";
import { daysBetween } from "./dates";
import type { Invoice } from "./types";

/** Days past due as of `asOf`; 0 when not yet due. */
export function daysOverdue(dueDate: string, asOf: string): number {
  return Math.max(0, daysBetween(dueDate, asOf));
}

export function bucketFor(days: number, buckets: readonly AgingBucket[] = DEFAULT_AGING_BUCKETS): AgingBucket {
  const bucket = buckets.find((b) => days >= b.minDays && (b.maxDays === null || days <= b.maxDays));
  if (!bucket) throw new RangeError(`No aging bucket covers ${days} days`);
  return bucket;
}

/** Invoices with an outstanding balance that existed on `asOf`. */
export function openInvoices(invoices: readonly Invoice[], asOf: string): Invoice[] {
  return invoices.filter((i) => i.status !== "Canceled" && i.remainingAmount > 0 && i.invoiceDate <= asOf);
}

export interface AgedInvoice extends Invoice {
  daysOverdue: number;
  bucketId: string;
}

export function ageInvoices(invoices: readonly Invoice[], asOf: string, buckets: readonly AgingBucket[] = DEFAULT_AGING_BUCKETS): AgedInvoice[] {
  return openInvoices(invoices, asOf).map((i) => {
    const days = daysOverdue(i.dueDate, asOf);
    return { ...i, daysOverdue: days, bucketId: bucketFor(days, buckets).id };
  });
}

export interface AgingSummary {
  asOf: string;
  buckets: { id: string; label: string; amount: number; count: number }[];
  openAmount: number;
  overdueAmount: number;
  overdueCount: number;
  oldestDaysOverdue: number;
}

export function summarizeAging(invoices: readonly Invoice[], asOf: string, buckets: readonly AgingBucket[] = DEFAULT_AGING_BUCKETS): AgingSummary {
  const aged = ageInvoices(invoices, asOf, buckets);
  const rows = buckets.map((b) => ({ id: b.id, label: b.label, amount: 0, count: 0 }));
  for (const inv of aged) {
    const row = rows.find((r) => r.id === inv.bucketId)!;
    row.amount = round2(row.amount + inv.remainingAmount);
    row.count += 1;
  }
  const overdue = aged.filter((i) => i.daysOverdue > 0);
  return {
    asOf,
    buckets: rows,
    openAmount: round2(sum(aged.map((i) => i.remainingAmount))),
    overdueAmount: round2(sum(overdue.map((i) => i.remainingAmount))),
    overdueCount: overdue.length,
    oldestDaysOverdue: Math.max(0, ...aged.map((i) => i.daysOverdue)),
  };
}

export function sum(values: readonly number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
