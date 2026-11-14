import { addDays } from "./dates";
import { BC_INVOICE_STATUS_OPEN, BC_TABLES } from "./schema";

const INV = BC_TABLES.salesInvoice;
const C = INV.columns;

export function escapeXml(value: string): string {
  return value.replace(/[<>&'"]/g, (ch) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[ch]!);
}

const INVOICE_ATTRIBUTES = [C.id, C.number, C.customerNumber, C.customerName, C.dueDate, C.remainingAmount, C.currency];

/**
 * No `top` attribute: on the Business Central virtual tables any FetchXML `top` makes the provider
 * return a single row (seen in the demo tenant). Callers cap results in code instead.
 */
function fetch(conditions: string[], orders: string[]): string {
  const attrs = INVOICE_ATTRIBUTES.map((a) => `<attribute name="${a}"/>`).join("");
  return `<fetch><entity name="${INV.logicalName}">${attrs}${orders.join("")}<filter type="and">${conditions.join("")}</filter></entity></fetch>`;
}

/** "Open" = posted and not fully paid. remainingAmount is not filterable on the BC virtual table. */
const OPEN = () => cond(C.status, "eq", String(BC_INVOICE_STATUS_OPEN));

const cond = (attribute: string, operator: string, value?: string) =>
  value === undefined ? `<condition attribute="${attribute}" operator="${operator}"/>` : `<condition attribute="${attribute}" operator="${operator}" value="${escapeXml(value)}"/>`;

export interface OverdueFetchOptions {
  asOf: string;
  customerNo?: string;
  minDaysOverdue?: number;
}

/** The "Overdue invoices" view filter, optionally scoped to one customer. */
export function buildOverdueInvoicesFetchXml({ asOf, customerNo, minDaysOverdue = 1 }: OverdueFetchOptions): string {
  const conditions = [OPEN(), cond(C.dueDate, "on-or-before", addDays(asOf, -minDaysOverdue))];
  if (customerNo) conditions.push(cond(C.customerNumber, "eq", customerNo));
  return fetch(conditions, [`<order attribute="${C.dueDate}"/>`]);
}

/** All open invoices (current + overdue), optionally for a set of customers. Feeds the dashboard. */
/** customerNumberPrefix (e.g. "DEMO-C-") scopes an all-customers query, as the MCP server does. */
export function buildOpenInvoicesFetchXml(customerNos?: readonly string[], customerNumberPrefix?: string): string {
  const conditions = [OPEN()];
  if (customerNos?.length) {
    conditions.push(`<condition attribute="${C.customerNumber}" operator="in">${customerNos.map((n) => `<value>${escapeXml(n)}</value>`).join("")}</condition>`);
  } else if (customerNumberPrefix) {
    conditions.push(`<condition attribute="${C.customerNumber}" operator="like" value="${escapeXml(customerNumberPrefix)}%" />`);
  }
  return fetch(conditions, [`<order attribute="${C.customerNumber}"/>`]);
}

/**
 * The prioritised "chase today" worklist. FetchXML cannot express our score, so the
 * list is restricted to the ranked ids and the receiver re-orders by `invoiceIds`.
 * Ordered by due date: remainingAmount can't be used for ordering on the BC virtual table.
 */
export function buildPrioritizedWorklistFetchXml(invoiceIds: readonly string[]): string {
  if (invoiceIds.length === 0) throw new RangeError("worklist needs at least one invoice id");
  const values = invoiceIds.map((id) => `<value>${escapeXml(id)}</value>`).join("");
  return fetch([`<condition attribute="${C.id}" operator="in">${values}</condition>`], [`<order attribute="${C.dueDate}"/>`]);
}
