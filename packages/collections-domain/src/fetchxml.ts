import { addDays } from "./dates";
import { BC_TABLES } from "./schema";

const INV = BC_TABLES.salesInvoice;
const C = INV.columns;

export function escapeXml(value: string): string {
  return value.replace(/[<>&'"]/g, (ch) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[ch]!);
}

const INVOICE_ATTRIBUTES = [C.id, C.number, C.customerNumber, C.customerName, C.dueDate, C.remainingAmount, C.currency];

function fetch(conditions: string[], orders: string[], top?: number): string {
  const attrs = INVOICE_ATTRIBUTES.map((a) => `<attribute name="${a}"/>`).join("");
  const topAttr = top ? ` top="${Math.trunc(top)}"` : "";
  return `<fetch${topAttr}><entity name="${INV.logicalName}">${attrs}${orders.join("")}<filter type="and">${conditions.join("")}</filter></entity></fetch>`;
}

const cond = (attribute: string, operator: string, value?: string) =>
  value === undefined ? `<condition attribute="${attribute}" operator="${operator}"/>` : `<condition attribute="${attribute}" operator="${operator}" value="${escapeXml(value)}"/>`;

export interface OverdueFetchOptions {
  asOf: string;
  customerNo?: string;
  minDaysOverdue?: number;
  top?: number;
}

/** The "Overdue invoices" view filter, optionally scoped to one customer. */
export function buildOverdueInvoicesFetchXml({ asOf, customerNo, minDaysOverdue = 1, top }: OverdueFetchOptions): string {
  const conditions = [cond(C.remainingAmount, "gt", "0"), cond(C.dueDate, "on-or-before", addDays(asOf, -minDaysOverdue))];
  if (customerNo) conditions.push(cond(C.customerNumber, "eq", customerNo));
  return fetch(conditions, [`<order attribute="${C.dueDate}"/>`], top);
}

/** All open invoices (current + overdue), optionally for a set of customers. Feeds the dashboard. */
export function buildOpenInvoicesFetchXml(customerNos?: readonly string[], top = 5000): string {
  const conditions = [cond(C.remainingAmount, "gt", "0")];
  if (customerNos?.length) {
    conditions.push(`<condition attribute="${C.customerNumber}" operator="in">${customerNos.map((n) => `<value>${escapeXml(n)}</value>`).join("")}</condition>`);
  }
  return fetch(conditions, [`<order attribute="${C.customerNumber}"/>`], top);
}

/**
 * The prioritised "chase today" worklist. FetchXML cannot express our score, so the
 * list is restricted to the ranked ids and the receiver re-orders by `invoiceIds`.
 * Within FetchXML we order by remaining amount, the closest proxy.
 */
export function buildPrioritizedWorklistFetchXml(invoiceIds: readonly string[]): string {
  if (invoiceIds.length === 0) throw new RangeError("worklist needs at least one invoice id");
  const values = invoiceIds.map((id) => `<value>${escapeXml(id)}</value>`).join("");
  return fetch([`<condition attribute="${C.id}" operator="in">${values}</condition>`], [`<order attribute="${C.remainingAmount}" descending="true"/>`], invoiceIds.length);
}
