import type { DashboardDimension, DashboardMeasure, DashboardSpec } from "@collections/contract";
import { ageInvoices, round2, type AgedInvoice } from "./aging";
import type { Customer, Invoice } from "./types";

export type MeasureValues = Record<DashboardMeasure, number>;

export interface DashboardData {
  dashboardId: string;
  version: number;
  asOf: string;
  measure: DashboardMeasure;
  currency: string;
  columns: { key: string; label: string }[];
  rows: { key: string; label: string; total: MeasureValues; cells: Record<string, MeasureValues> }[];
  totals: MeasureValues & { byColumn: Record<string, MeasureValues> };
}

const zero = (): MeasureValues => ({ overdueAmount: 0, openAmount: 0, invoiceCount: 0 });

function add(target: MeasureValues, inv: AgedInvoice): void {
  target.openAmount = round2(target.openAmount + inv.remainingAmount);
  if (inv.daysOverdue > 0) target.overdueAmount = round2(target.overdueAmount + inv.remainingAmount);
  target.invoiceCount += 1;
}

/**
 * Computes the matrix a DashboardSpec describes. Aging is done here, in code,
 * because BC virtual tables have limited aggregate / group-by support.
 * The same function runs in the MCP server (widget) and in the PCF (in-app).
 */
export function buildDashboardData(spec: DashboardSpec, customers: readonly Customer[], invoices: readonly Invoice[], asOf: string): DashboardData {
  const f = spec.filters;
  const customerByNo = new Map(customers.map((c) => [c.number, c]));
  const aged = ageInvoices(invoices, asOf, spec.buckets).filter(
    (i) =>
      (!f.customerNos?.length || f.customerNos.includes(i.customerNumber)) &&
      (!f.bucketIds?.length || f.bucketIds.includes(i.bucketId)) &&
      (f.minDaysOverdue === undefined || i.daysOverdue >= f.minDaysOverdue) &&
      (f.minAmount === undefined || i.remainingAmount >= f.minAmount) &&
      (!f.currency || i.currency === f.currency),
  );

  const dimension = (d: DashboardDimension, inv: AgedInvoice): { key: string; label: string } => {
    switch (d) {
      case "customer":
        return { key: inv.customerNumber, label: inv.customerName };
      case "agingBucket":
        return { key: inv.bucketId, label: spec.buckets.find((b) => b.id === inv.bucketId)?.label ?? inv.bucketId };
      case "salesperson": {
        const sp = customerByNo.get(inv.customerNumber)?.salesperson ?? "(none)";
        return { key: sp, label: sp };
      }
      case "currency":
        return { key: inv.currency, label: inv.currency };
    }
  };

  const [rowDim, colDim] = spec.groupBy;
  const measure = spec.measures[0]!;
  const rows = new Map<string, DashboardData["rows"][number]>();
  const columns = new Map<string, { key: string; label: string }>();
  const totals = { ...zero(), byColumn: {} as Record<string, MeasureValues> };

  for (const inv of aged) {
    const r = dimension(rowDim, inv);
    const c = dimension(colDim, inv);
    columns.set(c.key, c);
    const row = rows.get(r.key) ?? { ...r, total: zero(), cells: {} };
    rows.set(r.key, row);
    add((row.cells[c.key] ??= zero()), inv);
    add(row.total, inv);
    add((totals.byColumn[c.key] ??= zero()), inv);
    add(totals, inv);
  }

  // Aging columns always show every (selected) bucket in bucket order, even when empty.
  const columnList =
    colDim === "agingBucket"
      ? spec.buckets.filter((b) => !f.bucketIds?.length || f.bucketIds.includes(b.id)).map((b) => ({ key: b.id, label: b.label }))
      : [...columns.values()].sort((a, b) => totals.byColumn[b.key]![measure] - totals.byColumn[a.key]![measure]);

  const rowList = [...rows.values()]
    .filter((r) => r.total[measure] > 0)
    .sort((a, b) => b.total[measure] - a.total[measure] || a.label.localeCompare(b.label))
    .slice(0, f.topN ?? 50);

  return {
    dashboardId: spec.id,
    version: spec.version,
    asOf,
    measure,
    currency: f.currency ?? aged[0]?.currency ?? "EUR",
    columns: columnList,
    rows: rowList,
    totals,
  };
}
