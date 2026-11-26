import { isNewerSpec, type DashboardSpec } from "@collections/contract";
import type { Customer, Invoice } from "@collections/domain";
import { fixtures as defaultFixtures, type FixtureSet } from "@collections/domain/fixtures";
import type { CollectionsRepository, InvoiceQuery } from "./types";

/** Fixture-backed repository. Browser-safe, so the mock host can run the real server in-page. */
export class MockRepository implements CollectionsRepository {
  readonly mode = "mock" as const;
  /**
   * @param dashboards Pass a shared map to simulate one Dataverse table used by
   *   both the server and the app (the mock host does this).
   */
  constructor(
    private readonly data: FixtureSet = defaultFixtures,
    private readonly dashboards: Map<string, DashboardSpec> = new Map(),
  ) {}

  asOf(): string {
    return this.data.asOf;
  }

  async listCustomers(): Promise<Customer[]> {
    return [...this.data.customers];
  }

  async findCustomer({ customerNo, customerId }: { customerNo?: string; customerId?: string }): Promise<Customer | undefined> {
    const needle = customerNo?.trim().toLowerCase();
    return this.data.customers.find(
      (c) => (customerId && c.id === customerId) || (needle && (c.number.toLowerCase() === needle || c.name.toLowerCase().startsWith(needle))),
    );
  }

  async listInvoices({ customerNos, openOnly, since }: InvoiceQuery): Promise<Invoice[]> {
    return this.data.invoices.filter(
      (i) => (!customerNos || customerNos.includes(i.customerNumber)) && (!openOnly || i.remainingAmount > 0) && (!since || i.invoiceDate >= since),
    );
  }

  async getDashboard(id: string): Promise<DashboardSpec | undefined> {
    return this.dashboards.get(id);
  }

  async latestDashboard(): Promise<DashboardSpec | undefined> {
    return [...this.dashboards.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  }

  /** Last write wins on `version` (ties broken by updatedAt). */
  async saveDashboard(spec: DashboardSpec): Promise<DashboardSpec> {
    const current = this.dashboards.get(spec.id);
    if (isNewerSpec(spec, current)) this.dashboards.set(spec.id, spec);
    return this.dashboards.get(spec.id)!;
  }
}
