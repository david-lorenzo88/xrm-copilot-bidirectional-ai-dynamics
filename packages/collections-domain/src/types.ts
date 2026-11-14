/** A Business Central customer as surfaced through the `dyn365bc_customer_v2_0` virtual table. */
export interface Customer {
  id: string;
  number: string;
  name: string;
  currency: string;
  paymentTermsDays: number;
  creditLimit: number;
  salesperson: string;
  city?: string;
}

export type InvoiceStatus = "Open" | "Paid" | "Canceled";

/** A posted sales invoice (`dyn365bc_salesinvoice_v2_0`) enriched with its ledger close date. */
export interface Invoice {
  id: string;
  number: string;
  customerId: string;
  customerNumber: string;
  customerName: string;
  /** ISO dates, `YYYY-MM-DD`. */
  invoiceDate: string;
  dueDate: string;
  totalAmount: number;
  remainingAmount: number;
  currency: string;
  status: InvoiceStatus;
  /** Date the invoice was fully paid (customer ledger entry "Closed at Date"). */
  closedDate?: string;
}
