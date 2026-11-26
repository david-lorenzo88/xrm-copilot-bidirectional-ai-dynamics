import { DashboardSpec, isNewerSpec, type LogFollowUpPayload } from "@collections/contract";
import {
  BC_TABLES,
  LOCAL_TABLES,
  buildOpenInvoicesFetchXml,
  rowToCustomer,
  rowToInvoice,
  type Customer,
  type DataverseRow,
  type Invoice,
} from "@collections/domain";

/** What the bridge needs from Dataverse. The PCF uses context.webAPI; the mock host uses fixtures. */
export interface CollectionsDataService {
  findCustomer(customerNo: string): Promise<Customer | undefined>;
  openInvoices(customerNos?: readonly string[]): Promise<Invoice[]>;
  runFetchXml(fetchXml: string): Promise<Invoice[]>;
  listCustomers(): Promise<Customer[]>;
  loadDashboard(id: string): Promise<DashboardSpec | undefined>;
  /** Last write wins on spec.version; returns what is stored afterwards. */
  saveDashboard(spec: DashboardSpec): Promise<DashboardSpec>;
  createFollowUp(payload: LogFollowUpPayload): Promise<string>;
  /** Confirmed follow-ups and research notes for a customer, newest first. */
  listNotes(customerNo: string, top?: number): Promise<CustomerNote[]>;
  audit(entry: AuditEntry): Promise<void>;
}

export interface CustomerNote {
  id: string;
  kind: "followUp" | "research";
  title: string;
  note: string;
  sources: { title: string; url: string }[];
  createdOn: string;
}

/** Stored note text: the summary, then its sources (the column holds 4,000 characters). */
export function noteText(p: LogFollowUpPayload): string {
  const sources = p.sources?.length ? `\n\nSources:\n${p.sources.map((s) => `- ${s.title}: ${s.url}`).join("\n")}` : "";
  return (p.note + sources).slice(0, 4000);
}

export interface AuditEntry {
  actionId: string;
  outcome: "handled" | "rejected" | "cancelled" | "failed";
  customerNo?: string;
  payload?: unknown;
  detail?: string;
}

/** Subset of ComponentFramework.WebApi (and Xrm.WebApi) used here. */
export interface WebApiLike {
  retrieveMultipleRecords(entityType: string, options?: string, maxPageSize?: number): Promise<{ entities: DataverseRow[] }>;
  retrieveRecord(entityType: string, id: string, options?: string): Promise<DataverseRow>;
  createRecord(entityType: string, data: DataverseRow): Promise<{ id: string }>;
  updateRecord(entityType: string, id: string, data: DataverseRow): Promise<unknown>;
}

const INV = BC_TABLES.salesInvoice;
const CUS = BC_TABLES.customer;
const DASH = LOCAL_TABLES.dashboard;
const ACT = LOCAL_TABLES.action;
const odata = (v: string) => `'${v.replace(/'/g, "''")}'`;

export class WebApiDataService implements CollectionsDataService {
  /** customerNumberPrefix scopes all-customer reads (dashboard) the same way as the MCP server. */
  constructor(
    private readonly webApi: WebApiLike,
    private readonly options: { customerNumberPrefix?: string } = {},
  ) {}

  async findCustomer(customerNo: string): Promise<Customer | undefined> {
    const c = CUS.columns;
    const res = await this.webApi.retrieveMultipleRecords(CUS.logicalName, `?$select=${Object.values(c).join(",")}&$filter=${c.number} eq ${odata(customerNo)}&$top=1`);
    return res.entities[0] ? rowToCustomer(res.entities[0]) : undefined;
  }

  openInvoices(customerNos?: readonly string[]): Promise<Invoice[]> {
    return this.runFetchXml(buildOpenInvoicesFetchXml(customerNos, this.options.customerNumberPrefix));
  }

  async runFetchXml(fetchXml: string): Promise<Invoice[]> {
    const res = await this.webApi.retrieveMultipleRecords(INV.logicalName, `?fetchXml=${encodeURIComponent(fetchXml)}`);
    return res.entities.map(rowToInvoice);
  }

  async listCustomers(): Promise<Customer[]> {
    const prefix = this.options.customerNumberPrefix;
    const filter = prefix ? `&$filter=startswith(${CUS.columns.number},${odata(prefix)})` : "";
    const res = await this.webApi.retrieveMultipleRecords(CUS.logicalName, `?$select=${Object.values(CUS.columns).join(",")}${filter}`, 500);
    return res.entities.map(rowToCustomer);
  }

  async loadDashboard(id: string): Promise<DashboardSpec | undefined> {
    try {
      const row = await this.webApi.retrieveRecord(DASH.logicalName, id, `?$select=${DASH.columns.specJson}`);
      const parsed = DashboardSpec.safeParse(JSON.parse(String(row[DASH.columns.specJson] ?? "null")));
      return parsed.success ? parsed.data : undefined;
    } catch {
      return undefined; // not found
    }
  }

  async saveDashboard(spec: DashboardSpec): Promise<DashboardSpec> {
    const current = await this.loadDashboard(spec.id);
    if (!isNewerSpec(spec, current)) return current!;
    const c = DASH.columns;
    const row: DataverseRow = { [c.name]: spec.title, [c.specJson]: JSON.stringify(spec), [c.version]: spec.version };
    if (spec.filters.customerNos?.length === 1) row[c.customerNo] = spec.filters.customerNos[0];
    if (current) await this.webApi.updateRecord(DASH.logicalName, spec.id, row);
    else await this.webApi.createRecord(DASH.logicalName, { ...row, [c.id]: spec.id });
    return spec;
  }

  async createFollowUp(p: LogFollowUpPayload): Promise<string> {
    const c = ACT.columns;
    const res = await this.webApi.createRecord(ACT.logicalName, {
      [c.name]: p.kind === "research" ? `Research ${p.customerNo}` : `Follow-up ${p.customerNo}${p.promiseDate ? ` (promise ${p.promiseDate})` : ""}`,
      [c.actionId]: "Contoso.Collections.LogFollowUp",
      [c.customerNo]: p.customerNo,
      [c.note]: noteText(p),
      [c.promiseDate]: p.promiseDate ?? null,
      [c.promisedAmount]: p.promisedAmount ?? null,
      [c.payloadJson]: JSON.stringify(p),
      [c.source]: "agent",
      [c.outcome]: "confirmed",
    });
    return res.id;
  }

  async listNotes(customerNo: string, top = 5): Promise<CustomerNote[]> {
    const c = ACT.columns;
    const filter = `${c.customerNo} eq ${odata(customerNo)} and ${c.actionId} eq 'Contoso.Collections.LogFollowUp' and ${c.outcome} eq 'confirmed'`;
    const res = await this.webApi.retrieveMultipleRecords(ACT.logicalName, `?$select=${c.name},${c.note},${c.payloadJson},createdon&$filter=${filter}&$orderby=createdon desc&$top=${top}`);
    return res.entities.map((r) => {
      let p: Partial<LogFollowUpPayload> = {};
      try {
        p = JSON.parse(String(r[c.payloadJson] ?? "{}")) as Partial<LogFollowUpPayload>;
      } catch {
        /* older rows: note only */
      }
      return {
        id: String(r[c.id] ?? ""),
        kind: p.kind === "research" ? "research" : "followUp",
        title: String(r[c.name] ?? ""),
        note: p.note ?? String(r[c.note] ?? ""),
        sources: p.sources ?? [],
        createdOn: String(r.createdon ?? ""),
      };
    });
  }

  async audit(e: AuditEntry): Promise<void> {
    const c = ACT.columns;
    await this.webApi.createRecord(ACT.logicalName, {
      [c.name]: `${e.actionId} ${e.outcome}`,
      [c.actionId]: e.actionId,
      [c.customerNo]: e.customerNo ?? null,
      [c.payloadJson]: e.payload === undefined ? null : JSON.stringify(e.payload).slice(0, 100_000),
      [c.note]: e.detail ?? null,
      [c.source]: "agent",
      [c.outcome]: e.outcome,
    });
  }
}
