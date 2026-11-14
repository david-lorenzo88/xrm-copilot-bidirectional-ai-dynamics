import { DashboardSpec, isNewerSpec } from "@collections/contract";
import { BC_INVOICE_STATUS_OPEN, BC_TABLES, LOCAL_TABLES, formatIsoDate, rowToCustomer, rowToInvoice, type Customer, type Invoice } from "@collections/domain";
import { DataverseClient, DataverseError, odataString, type Row } from "./dataverse-client";
import type { CollectionsRepository, InvoiceQuery } from "./types";

const CUS = BC_TABLES.customer;
const INV = BC_TABLES.salesInvoice;
const CLE = BC_TABLES.customerLedgerEntry;
const DASH = LOCAL_TABLES.dashboard;

const str = (row: Row, col: string) => (row[col] == null ? "" : String(row[col]));
const date = (row: Row, col: string) => str(row, col).slice(0, 10);

/**
 * BC virtual tables + local tables over the Dataverse Web API, as the signed-in
 * user (OBO), so Dataverse security roles apply. Read-only towards BC: the only
 * writes go to ppn_collectiondashboard.
 */
export class DataverseRepository implements CollectionsRepository {
  readonly mode = "dataverse" as const;
  private ledgerAvailable = true;

  constructor(
    private readonly client: DataverseClient,
    /** customerNumberPrefix scopes every BC read (e.g. "DEMO-C-" for the seeded demo customers). */
    private readonly options: { customerNumberPrefix?: string } = {},
  ) {}

  private scope(column: string): string[] {
    const p = this.options.customerNumberPrefix;
    return p ? [`startswith(${column},${odataString(p)})`] : [];
  }

  asOf(): string {
    return formatIsoDate(new Date());
  }

  async listCustomers(): Promise<Customer[]> {
    const c = CUS.columns;
    const scoped = this.scope(c.number);
    const rows = await this.client.list(CUS.entitySet, `$select=${Object.values(c).join(",")}${scoped.length ? `&$filter=${encodeURIComponent(scoped.join(" and "))}` : ""}&$top=500`);
    return rows.map(rowToCustomer);
  }

  async findCustomer({ customerNo, customerId }: { customerNo?: string; customerId?: string }): Promise<Customer | undefined> {
    const c = CUS.columns;
    if (customerId) {
      const row = await this.client.get(CUS.entitySet, customerId, Object.values(c));
      return row ? rowToCustomer(row) : undefined;
    }
    if (!customerNo) return undefined;
    // The BC virtual table rejects OR across different fields: match the number first, then a name prefix.
    const select = `$select=${Object.values(c).join(",")}`;
    for (const filter of [`${c.number} eq ${odataString(customerNo)}`, [`startswith(${c.name},${odataString(customerNo)})`, ...this.scope(c.number)].join(" and ")]) {
      const rows = await this.client.list(CUS.entitySet, `${select}&$filter=${encodeURIComponent(filter)}&$top=1`);
      if (rows[0]) return rowToCustomer(rows[0]);
    }
    return undefined;
  }

  async listInvoices({ customerNos, openOnly, since }: InvoiceQuery): Promise<Invoice[]> {
    const c = INV.columns;
    const filters: string[] = customerNos?.length ? [] : this.scope(c.customerNumber);
    if (customerNos?.length) filters.push(`(${customerNos.map((n) => `${c.customerNumber} eq ${odataString(n)}`).join(" or ")})`);
    // remainingAmount isn't filterable on the BC virtual table: filter on status Open, check the amount here.
    if (openOnly) filters.push(`${c.status} eq ${BC_INVOICE_STATUS_OPEN}`);
    if (since) filters.push(`${c.invoiceDate} ge ${since}`);
    const query = `$select=${Object.values(c).join(",")}${filters.length ? `&$filter=${encodeURIComponent(filters.join(" and "))}` : ""}`;
    const invoices = (await this.client.list(INV.entitySet, query)).map(rowToInvoice).filter((i) => !openOnly || i.remainingAmount > 0);
    return openOnly ? invoices : this.attachClosedDates(invoices, customerNos, since);
  }

  /**
   * Paid dates come from customer ledger entries (custom API page, see /bc).
   * If that table isn't enabled the analysis degrades to open invoices only.
   */
  private async attachClosedDates(invoices: Invoice[], customerNos?: readonly string[], since?: string): Promise<Invoice[]> {
    if (!this.ledgerAvailable) return invoices;
    const c = CLE.columns;
    const filters = [`${c.open} eq false`, ...(customerNos?.length ? [] : this.scope(c.customerNumber))];
    if (customerNos?.length) filters.push(`(${customerNos.map((n) => `${c.customerNumber} eq ${odataString(n)}`).join(" or ")})`);
    if (since) filters.push(`${c.dueDate} ge ${since}`);
    try {
      const rows = await this.client.list(CLE.entitySet, `$select=${c.documentNo},${c.closedAtDate}&$filter=${encodeURIComponent(filters.join(" and "))}`);
      const closed = new Map(rows.map((r) => [str(r, c.documentNo), date(r, c.closedAtDate)]));
      return invoices.map((i) => (i.remainingAmount === 0 && closed.get(i.number) ? { ...i, closedDate: closed.get(i.number) } : i));
    } catch (err) {
      if (err instanceof DataverseError && (err.status === 404 || err.status === 400)) {
        this.ledgerAvailable = false;
        console.warn(`[dataverse] ${CLE.logicalName} unavailable; payment history limited to open invoices`);
        return invoices;
      }
      throw err;
    }
  }

  async getDashboard(id: string): Promise<DashboardSpec | undefined> {
    const row = await this.client.get(DASH.entitySet, id, [DASH.columns.specJson, DASH.columns.version]);
    if (!row) return undefined;
    const parsed = DashboardSpec.safeParse(JSON.parse(str(row, DASH.columns.specJson) || "null"));
    return parsed.success ? parsed.data : undefined;
  }

  async saveDashboard(spec: DashboardSpec): Promise<DashboardSpec> {
    const current = await this.getDashboard(spec.id);
    if (!isNewerSpec(spec, current)) return current!;
    const c = DASH.columns;
    await this.client.upsert(DASH.entitySet, spec.id, {
      [c.name]: spec.title,
      [c.specJson]: JSON.stringify(spec),
      [c.version]: spec.version,
      [c.customerNo]: spec.filters.customerNos?.length === 1 ? spec.filters.customerNos[0] : null,
    });
    return spec;
  }
}
