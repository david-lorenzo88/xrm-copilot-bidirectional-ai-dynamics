import { BC_TABLES } from "./schema";
import type { Customer, Invoice, InvoiceStatus } from "./types";

/** A row from the Dataverse Web API (or Xrm.WebApi / context.webAPI). */
export type DataverseRow = Record<string, unknown>;

export const FORMATTED_VALUE = "@OData.Community.Display.V1.FormattedValue";

const str = (row: DataverseRow, col: string) => (row[col] == null ? "" : String(row[col]));
const num = (row: DataverseRow, col: string) => Number(row[col] ?? 0);
const date = (row: DataverseRow, col: string) => str(row, col).slice(0, 10);

export function rowToCustomer(row: DataverseRow): Customer {
  const c = BC_TABLES.customer.columns;
  return {
    id: str(row, c.id),
    number: str(row, c.number),
    name: str(row, c.name),
    currency: str(row, c.currency) || "EUR",
    paymentTermsDays: 30,
    creditLimit: num(row, c.creditLimit),
    salesperson: str(row, c.salesperson),
    city: str(row, c.city) || undefined,
  };
}

/** VERIFY: BC enum columns may surface as choice values; prefer the formatted label when present. */
export function rowToStatus(row: DataverseRow): InvoiceStatus {
  const col = BC_TABLES.salesInvoice.columns.status;
  const label = String(row[`${col}${FORMATTED_VALUE}`] ?? row[col] ?? "");
  if (/paid/i.test(label)) return "Paid";
  if (/cancel/i.test(label)) return "Canceled";
  return "Open";
}

export function rowToInvoice(row: DataverseRow): Invoice {
  const c = BC_TABLES.salesInvoice.columns;
  return {
    id: str(row, c.id),
    number: str(row, c.number),
    customerId: str(row, c.customerId),
    customerNumber: str(row, c.customerNumber),
    customerName: str(row, c.customerName),
    invoiceDate: date(row, c.invoiceDate),
    dueDate: date(row, c.dueDate),
    totalAmount: num(row, c.totalAmount),
    remainingAmount: num(row, c.remainingAmount),
    currency: str(row, c.currency) || "EUR",
    status: rowToStatus(row),
  };
}
