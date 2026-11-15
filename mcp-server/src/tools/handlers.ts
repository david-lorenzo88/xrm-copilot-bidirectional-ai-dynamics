import {
  ActionIds,
  CONTRACT_VERSION,
  applyDashboardPatch,
  createDashboardSpec,
  type CollectionsContext,
  type DashboardPatch,
  type DashboardSpec,
  type LogFollowUpPayload,
  type NewDashboardInput,
  type OpenInvoicesPayload,
  type ShowWorklistPayload,
} from "@collections/contract";
import {
  BC_TABLES,
  addDays,
  ageInvoices,
  analyzePaymentBehavior,
  buildDashboardData,
  buildOverdueInvoicesFetchXml,
  buildPrioritizedWorklistFetchXml,
  prioritizeWorklist,
  summarizeAging,
  type Customer,
  type DashboardData,
  type PaymentBehavior,
  type WorklistItem,
} from "@collections/domain";
import { NotFoundError, type CollectionsRepository } from "../repository/types";

/** Pure tool logic. Registration (schemas, annotations, widgets) lives in register.ts. */

async function requireCustomer(repo: CollectionsRepository, ref: { customerNo?: string; customerId?: string }): Promise<Customer> {
  const customer = await repo.findCustomer(ref);
  if (!customer) throw new NotFoundError(`Customer not found: ${ref.customerNo ?? ref.customerId ?? "(none given)"}. Ask the user which customer they mean.`);
  return customer;
}

export async function getCustomerContext(repo: CollectionsRepository, ref: { customerNo?: string; customerId?: string }) {
  const customer = await requireCustomer(repo, ref);
  const asOf = repo.asOf();
  const invoices = await repo.listInvoices({ customerNos: [customer.number], since: addDays(asOf, -366) });
  const behavior = analyzePaymentBehavior(customer, invoices, asOf);
  const topOverdue = ageInvoices(invoices, asOf)
    .filter((i) => i.daysOverdue > 0)
    .sort((a, b) => b.daysOverdue - a.daysOverdue)
    .slice(0, 10)
    .map(({ id, number, dueDate, daysOverdue, bucketId, remainingAmount, currency }) => ({ id, number, dueDate, daysOverdue, bucketId, remainingAmount, currency }));
  const context: CollectionsContext = {
    contractVersion: CONTRACT_VERSION,
    entity: BC_TABLES.customer.logicalName,
    recordId: customer.id,
    customerNo: customer.number,
    customerName: customer.name,
    view: "Overdue invoices",
    filterXML: buildOverdueInvoicesFetchXml({ asOf, customerNo: customer.number }),
    overdueTotal: behavior.overdueAmount,
    currency: customer.currency,
  };
  return {
    asOf,
    customer,
    aging: summarizeAging(invoices, asOf),
    risk: { riskScore: behavior.riskScore, riskLevel: behavior.riskLevel, trend: behavior.trend },
    topOverdue,
    context,
  };
}

export async function analyzeBehavior(repo: CollectionsRepository, args: { customerNo: string; lookbackMonths?: number }): Promise<PaymentBehavior> {
  const customer = await requireCustomer(repo, { customerNo: args.customerNo });
  const asOf = repo.asOf();
  const months = args.lookbackMonths ?? 12;
  const invoices = await repo.listInvoices({ customerNos: [customer.number], since: addDays(asOf, -Math.round(months * 30.44) - 90) });
  return analyzePaymentBehavior(customer, invoices, asOf, { lookbackMonths: months });
}

export interface PrioritizeResult {
  asOf: string;
  scope: { customerNo?: string; customerName?: string };
  items: WorklistItem[];
  /** Ready-to-post app actions; the widget sends them via postMessage. */
  actions: { openInvoices: OpenInvoicesPayload | null; showWorklist: ShowWorklistPayload | null };
  /** When true the widget posts the actions as soon as it renders (navigation only, no writes). */
  autoApply: boolean;
  actionIds: { openInvoices: string; showWorklist: string };
}

export async function prioritize(
  repo: CollectionsRepository,
  args: { customerNo?: string; limit?: number; minDaysOverdue?: number; applyInApp?: boolean },
): Promise<PrioritizeResult> {
  const customer = args.customerNo ? await requireCustomer(repo, { customerNo: args.customerNo }) : undefined;
  const asOf = repo.asOf();
  const [customers, invoices] = await Promise.all([
    customer ? Promise.resolve([customer]) : repo.listCustomers(),
    repo.listInvoices({ customerNos: customer ? [customer.number] : undefined, since: addDays(asOf, -456) }),
  ]);
  const items = prioritizeWorklist(customers, invoices, asOf, { customerNo: customer?.number, limit: args.limit ?? 15, minDaysOverdue: args.minDaysOverdue });
  const critical = items.filter((i) => i.critical);
  const title = customer ? `Chase today: ${customer.name}` : "Chase today";
  return {
    asOf,
    scope: customer ? { customerNo: customer.number, customerName: customer.name } : {},
    items,
    actions: {
      openInvoices: critical.length
        ? { contractVersion: CONTRACT_VERSION, invoiceIds: critical.map((i) => i.invoiceId), invoiceNumbers: critical.map((i) => i.invoiceNo) }
        : null,
      showWorklist: items.length
        ? { contractVersion: CONTRACT_VERSION, title, fetchXml: buildPrioritizedWorklistFetchXml(items.map((i) => i.invoiceId)), invoiceIds: items.map((i) => i.invoiceId), suggestedActions: items.map((i) => i.suggestedAction) }
        : null,
    },
    autoApply: args.applyInApp ?? true,
    actionIds: { openInvoices: ActionIds.OpenInvoices, showWorklist: ActionIds.ShowWorklist },
  };
}

export interface FollowUpProposal {
  kind: "followUpProposal";
  customer: { number: string; name: string };
  /** Sent to the app only when the user clicks "Log in app" in the widget; the app asks again. */
  payload: LogFollowUpPayload;
  actionId: typeof ActionIds.LogFollowUp;
}

/** Proposes a follow-up. Writes nothing: the widget hands it to the app, which confirms and stores it. */
export async function proposeFollowUp(
  repo: CollectionsRepository,
  args: { customerNo: string; note: string; promiseDate?: string; promisedAmount?: number },
): Promise<FollowUpProposal> {
  const customer = await requireCustomer(repo, { customerNo: args.customerNo });
  const payload: LogFollowUpPayload = { contractVersion: CONTRACT_VERSION, customerNo: customer.number, note: args.note };
  if (args.promiseDate) payload.promiseDate = args.promiseDate;
  if (args.promisedAmount !== undefined) payload.promisedAmount = args.promisedAmount;
  return { kind: "followUpProposal", customer: { number: customer.number, name: customer.name }, payload, actionId: ActionIds.LogFollowUp };
}

export interface DashboardResult {
  spec: DashboardSpec;
  data: DashboardData;
  /** True when this write replaced a version the caller had not seen (last write wins). */
  overwroteNewerVersion?: boolean;
}

async function withData(repo: CollectionsRepository, spec: DashboardSpec): Promise<DashboardResult> {
  const [customers, invoices] = await Promise.all([repo.listCustomers(), repo.listInvoices({ customerNos: spec.filters.customerNos, openOnly: true })]);
  return { spec, data: buildDashboardData(spec, customers, invoices, spec.asOf ?? repo.asOf()) };
}

export type BuildDashboardArgs = Pick<NewDashboardInput, "title" | "groupBy" | "measures" | "filters" | "visual"> & { dashboardId?: string };

export async function buildDashboard(repo: CollectionsRepository, { dashboardId, ...input }: BuildDashboardArgs): Promise<DashboardResult> {
  const patch = stripUndefined(input);
  const existing = dashboardId ? await repo.getDashboard(dashboardId) : undefined;
  const spec = existing
    ? applyDashboardPatch(existing, patch, "agent")
    : createDashboardSpec({ id: dashboardId ?? crypto.randomUUID(), ...patch, updatedBy: "agent" });
  return withData(repo, await repo.saveDashboard(spec));
}

/** Without an id: the most recently changed dashboard (the agent rarely gets the app's dashboardId). */
export async function getDashboard(repo: CollectionsRepository, dashboardId?: string): Promise<DashboardResult> {
  const spec = dashboardId ? await repo.getDashboard(dashboardId) : await repo.latestDashboard();
  if (!spec) throw new NotFoundError(dashboardId ? `Dashboard not found: ${dashboardId}` : "No dashboard yet: build one with build_aging_dashboard");
  return withData(repo, spec);
}

export async function updateDashboard(
  repo: CollectionsRepository,
  args: { dashboardId: string; expectedVersion?: number; patch: DashboardPatch; updatedBy?: DashboardSpec["updatedBy"] },
): Promise<DashboardResult> {
  const current = await repo.getDashboard(args.dashboardId);
  if (!current) throw new NotFoundError(`Dashboard not found: ${args.dashboardId}`);
  const next = applyDashboardPatch(current, stripUndefined(args.patch), args.updatedBy ?? "agent");
  const saved = await repo.saveDashboard(next);
  const result = await withData(repo, saved);
  return args.expectedVersion !== undefined && args.expectedVersion !== current.version ? { ...result, overwroteNewerVersion: true } : result;
}

function stripUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}
