import type { PaymentBehavior } from "@collections/domain";
import type { CustomerUpdateProposal, DashboardResult, NewCustomerProposal, FollowUpProposal, PrioritizeResult, getCustomerContext } from "./handlers";

/** Short, number-rich text for the model. The widget uses structuredContent instead. */

const money = (n: number, ccy = "EUR") => `${ccy} ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function summarizeContext(r: Awaited<ReturnType<typeof getCustomerContext>>): string {
  const buckets = r.aging.buckets.filter((b) => b.amount > 0).map((b) => `${b.label}: ${money(b.amount, r.customer.currency)} (${b.count})`);
  return [
    `${r.customer.name} (${r.customer.number}) as of ${r.asOf}.`,
    `Open ${money(r.aging.openAmount, r.customer.currency)}, overdue ${money(r.aging.overdueAmount, r.customer.currency)} across ${r.aging.overdueCount} invoice(s); oldest ${r.aging.oldestDaysOverdue} days.`,
    `Aging: ${buckets.join("; ") || "nothing open"}.`,
    `Risk ${r.risk.riskScore}/100 (${r.risk.riskLevel}), trend ${r.risk.trend}.`,
    `Top overdue: ${r.topOverdue.map((i) => `${i.number} ${money(i.remainingAmount, i.currency)} ${i.daysOverdue}d`).join(", ") || "none"}.`,
  ].join("\n");
}

export function summarizeBehavior(b: PaymentBehavior): string {
  return [
    `${b.customerName} (${b.customerNo}), last ${b.lookbackMonths} months as of ${b.asOf}:`,
    `avg ${b.avgDaysLate} days late (amount-weighted ${b.weightedAvgDaysLate}); recent ${b.recentAvgDaysLate} vs prior ${b.priorAvgDaysLate}; on time ${Math.round(b.onTimeRate * 100)}%.`,
    `Trend ${b.trend} (${b.trendDaysPerMonth >= 0 ? "+" : ""}${b.trendDaysPerMonth} days/month). Risk ${b.riskScore}/100 (${b.riskLevel}).`,
    `Overdue ${money(b.overdueAmount, b.currency)}, of which 61+ days ${money(b.severeOverdueAmount, b.currency)}; credit utilisation ${Math.round(b.creditUtilization * 100)}%.`,
    `Signals: ${b.signals.join("; ")}.`,
  ].join("\n");
}

export function summarizeWorklist(r: PrioritizeResult): string {
  const lines = r.items.slice(0, 10).map(
    (i) => `${i.rank}. ${i.invoiceNo} ${i.customerName} ${money(i.remainingAmount, i.currency)} ${i.daysOverdue}d score ${i.score}${i.critical ? " CRITICAL" : ""} – ${i.suggestedAction} (${i.reasons.join(", ")})`,
  );
  const scope = r.scope.customerName ?? "all customers";
  const applied = r.autoApply ? "The widget is showing the worklist in the app; the user opens the critical invoices in side panes from the widget." : "The user can open the invoices and the worklist from the widget.";
  return [`Chase-today list for ${scope} as of ${r.asOf}: ${r.items.length} overdue invoice(s).`, ...lines, applied].join("\n");
}

export function summarizeDashboard(r: DashboardResult): string {
  const { spec, data } = r;
  const rows = data.rows.slice(0, 8).map((row) => `${row.label}: ${money(row.total[data.measure], data.currency)}`);
  return [
    `Dashboard "${spec.title}" id ${spec.id} v${spec.version} (${spec.groupBy.join(" × ")}, ${data.measure}).`,
    `Filters: ${JSON.stringify(spec.filters)}. Total ${money(data.totals[data.measure], data.currency)}.`,
    `Top rows: ${rows.join("; ") || "none"}.`,
    r.overwroteNewerVersion ? "Note: this overwrote a newer version (last write wins)." : "",
    "The widget shows it here and in the app.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function summarizeCustomerUpdate(p: CustomerUpdateProposal): string {
  const c = p.payload.changes;
  const parts: string[] = [];
  if (c.creditLimit !== undefined) parts.push(`credit limit ${money(p.customer.creditLimit, p.customer.currency)} → ${money(c.creditLimit, p.customer.currency)}`);
  if (c.blocked !== undefined) parts.push(`Blocked → ${c.blocked || "not blocked"}`);
  return `Proposed change for ${p.customer.name} (${p.customer.number}): ${parts.join(", ")}. Reason: ${p.payload.reason}. Nothing is changed yet: the user applies it to the open form from the card, reviews it and saves; saving writes to Business Central.`;
}

export function summarizeNewCustomer(p: NewCustomerProposal): string {
  const c = p.payload.customer;
  const filled = Object.entries(c).filter(([k, v]) => v !== undefined && k !== "name" && k !== "number").map(([k]) => k);
  return `Proposed new customer ${c.name} as ${c.number} (from: ${p.payload.source}); fields: ${filled.join(", ") || "name only"}. Nothing is created yet: the user opens it on a pre-filled form from the card, reviews it and saves; saving creates it in Business Central.`;
}

export function summarizeFollowUp(p: FollowUpProposal): string {
  if (p.payload.kind === "research") {
    return `Proposed research note for ${p.customer.name} (${p.customer.number}) with ${p.payload.sources?.length ?? 0} source(s). Nothing is stored yet: the user inserts it into the record from the card and confirms in the app.`;
  }
  const promise = p.payload.promiseDate ? ` Promise to pay by ${p.payload.promiseDate}${p.payload.promisedAmount !== undefined ? ` (${p.payload.promisedAmount.toFixed(2)})` : ""}.` : "";
  return `Proposed follow-up for ${p.customer.name} (${p.customer.number}): "${p.payload.note}".${promise} Nothing is logged yet: the user sends it to the app from the card and confirms there.`;
}
