import { isNewerSpec, type DashboardSpec, type LogFollowUpPayload } from "@collections/contract";
import { BC_TABLES, type Customer, type Invoice } from "@collections/domain";
import { fixtures as defaultFixtures, type FixtureSet } from "@collections/domain/fixtures";
import type { AuditEntry, CollectionsDataService, CustomerNote } from "../bridge/data";

/**
 * In-memory CollectionsDataService over the demo fixtures. Used by the mock host
 * and tests; never imported by the control's index.ts, so it is not bundled.
 */
export class FixtureDataService implements CollectionsDataService {
  readonly actionLog: (AuditEntry & { at: string; id: string; kind: "audit" | "followUp" })[] = [];
  private seq = 0;

  constructor(
    private readonly data: FixtureSet = defaultFixtures,
    /** Share with MockRepository to simulate the one ppn_collectiondashboard table. */
    readonly dashboards: Map<string, DashboardSpec> = new Map(),
  ) {}

  async findCustomer(customerNo: string): Promise<Customer | undefined> {
    return this.data.customers.find((c) => c.number === customerNo);
  }

  async openInvoices(customerNos?: readonly string[]): Promise<Invoice[]> {
    return this.data.invoices.filter((i) => i.remainingAmount > 0 && (!customerNos?.length || customerNos.includes(i.customerNumber)));
  }

  /** Understands the FetchXML our builders produce: an `in` list of invoice ids, or a customer filter. */
  async runFetchXml(fetchXml: string): Promise<Invoice[]> {
    const idCol = BC_TABLES.salesInvoice.columns.id;
    const ids = new RegExp(`attribute="${idCol}" operator="in">(.*?)</condition>`).exec(fetchXml)?.[1];
    if (ids) {
      const wanted = new Set([...ids.matchAll(/<value>([^<]+)<\/value>/g)].map((m) => m[1]));
      return this.data.invoices.filter((i) => wanted.has(i.id));
    }
    const customerNo = /customernumber" operator="eq" value="([^"]+)"/.exec(fetchXml)?.[1];
    return this.openInvoices(customerNo ? [customerNo] : undefined);
  }

  async listCustomers(): Promise<Customer[]> {
    return [...this.data.customers];
  }

  async loadDashboard(id: string): Promise<DashboardSpec | undefined> {
    return this.dashboards.get(id);
  }

  async saveDashboard(spec: DashboardSpec): Promise<DashboardSpec> {
    if (isNewerSpec(spec, this.dashboards.get(spec.id))) this.dashboards.set(spec.id, spec);
    return this.dashboards.get(spec.id)!;
  }

  async createFollowUp(p: LogFollowUpPayload): Promise<string> {
    const id = `followup-${++this.seq}`;
    this.actionLog.push({ id, kind: "followUp", at: new Date().toISOString(), actionId: "Contoso.Collections.LogFollowUp", outcome: "handled", customerNo: p.customerNo, payload: p, detail: p.note });
    return id;
  }

  async companyOf(_customerNo: string): Promise<{ id: string; name: string } | undefined> {
    return { id: "00000000-0000-0000-0000-00000000c0de", name: "CRONUS ES" };
  }

  async listNotes(customerNo: string, top = 5): Promise<CustomerNote[]> {
    return this.actionLog
      .filter((e) => e.kind === "followUp" && e.customerNo === customerNo)
      .reverse()
      .slice(0, top)
      .map((e) => {
        const p = e.payload as LogFollowUpPayload;
        return { id: e.id, kind: p.kind === "research" ? "research" : "followUp", title: p.kind === "research" ? `Research ${p.customerNo}` : `Follow-up ${p.customerNo}`, note: p.note, sources: p.sources ?? [], createdOn: e.at };
      });
  }

  async audit(entry: AuditEntry): Promise<void> {
    this.actionLog.push({ ...entry, id: `audit-${++this.seq}`, kind: "audit", at: new Date().toISOString() });
  }
}
