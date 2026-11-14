import type { DashboardSpec } from "@collections/contract";
import type { Customer, Invoice } from "@collections/domain";

export interface InvoiceQuery {
  /** Restrict to these customers (omit for all). */
  customerNos?: readonly string[];
  /** Only invoices with an outstanding balance. */
  openOnly?: boolean;
  /** Include invoices issued on/after this date (payment history window). */
  since?: string;
}

/**
 * Everything the tools need from the data layer. Two implementations:
 * MockRepository (fixtures, in-memory dashboards) and DataverseRepository
 * (BC virtual tables + local tables over the Dataverse Web API, OBO token).
 */
export interface CollectionsRepository {
  readonly mode: "mock" | "dataverse";
  /** "Today" for aging. Fixed in mock mode so the demo is repeatable. */
  asOf(): string;
  listCustomers(): Promise<Customer[]>;
  findCustomer(ref: { customerNo?: string; customerId?: string }): Promise<Customer | undefined>;
  listInvoices(query: InvoiceQuery): Promise<Invoice[]>;
  getDashboard(id: string): Promise<DashboardSpec | undefined>;
  saveDashboard(spec: DashboardSpec): Promise<DashboardSpec>;
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}
