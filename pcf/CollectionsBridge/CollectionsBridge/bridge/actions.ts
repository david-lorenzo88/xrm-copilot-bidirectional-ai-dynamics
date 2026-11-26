import {
  MAX_SIDE_PANES,
  type DashboardSpec,
  type LogFollowUpPayload,
  type OpenInvoicesPayload,
  type RenderDashboardPayload,
  type ShowWorklistPayload,
} from "@collections/contract";
import { BC_TABLES, buildDashboardData, rankedWorklist, type DashboardData, type WorklistItem } from "@collections/domain";
import type { CollectionsDataService } from "./data";
import type { SidePanes, XrmNavigation } from "./xrm";

/** Agent → app: one side pane per critical invoice (reuses a pane if it is already open). */
export async function openInvoicesInSidePanes(sidePanes: SidePanes, { invoiceIds, invoiceNumbers }: OpenInvoicesPayload): Promise<void> {
  for (const [i, entityId] of invoiceIds.slice(0, MAX_SIDE_PANES).entries()) {
    const paneId = `contoso-invoice-${entityId}`;
    const existing = sidePanes.getPane?.(paneId);
    if (existing) {
      existing.select?.();
      continue;
    }
    const pane = await sidePanes.createPane({ title: invoiceNumbers?.[i] ?? "Invoice", paneId, canClose: true, width: 480 });
    await pane.navigate({ pageType: "entityrecord", entityName: BC_TABLES.salesInvoice.logicalName, entityId });
  }
}

/**
 * Agent → app: the prioritised worklist. FetchXML can't carry our ranking, so we
 * run it, re-order by the payload's invoiceIds and render it in the control.
 */
export async function loadWorklist(data: CollectionsDataService, payload: ShowWorklistPayload, asOf: string): Promise<{ title: string; items: WorklistItem[] }> {
  const invoices = await data.runFetchXml(payload.fetchXml);
  return { title: payload.title, items: rankedWorklist(invoices, payload.invoiceIds ?? [], asOf, payload.suggestedActions) };
}

/**
 * Optionally also switch the main grid to a saved "Chase today" view.
 * VERIFY: navigateTo(entitylist) accepts a saved view id but no ad-hoc FetchXML;
 * the built-in MS.PA.CopilotChat.NavigateToView takes FetchXML if you prefer the platform behaviour.
 */
export async function navigateToWorklistView(navigation: XrmNavigation | undefined, viewId: string | undefined): Promise<void> {
  if (!navigation || !viewId) return;
  await navigation.navigateTo({ pageType: "entitylist", entityName: BC_TABLES.salesInvoice.logicalName, viewId, viewType: "savedquery" });
}

/** Agent → app: persist the spec (shared state), then compute the same matrix in-app. */
export async function resolveDashboard(data: CollectionsDataService, payload: RenderDashboardPayload): Promise<DashboardSpec | undefined> {
  if (payload.spec) return data.saveDashboard(payload.spec);
  return data.loadDashboard(payload.dashboardId!);
}

export async function computeDashboard(data: CollectionsDataService, spec: DashboardSpec, asOf: string): Promise<DashboardData> {
  const [customers, invoices] = await Promise.all([data.listCustomers(), data.openInvoices(spec.filters.customerNos)]);
  return buildDashboardData(spec, customers, invoices, spec.asOf ?? asOf);
}

/** Agent proposes, user confirms: the only write path, and it stays in Dataverse (never BC). */
export async function confirmAndLogFollowUp(navigation: XrmNavigation, data: CollectionsDataService, p: LogFollowUpPayload): Promise<string | undefined> {
  const research = p.kind === "research";
  const lines = [`Customer ${p.customerNo}`, p.note];
  if (p.promiseDate) lines.push(`Promise to pay: ${p.promiseDate}${p.promisedAmount ? ` (${p.promisedAmount.toFixed(2)})` : ""}`);
  if (p.sources?.length) lines.push(`Sources: ${p.sources.map((s) => s.title).join(" · ")}`);
  const { confirmed } = await navigation.openConfirmDialog({
    title: research ? "Insert web research from Copilot into this record?" : "Log follow-up proposed by Copilot?",
    text: lines.join("\n"),
    confirmButtonLabel: research ? "Insert research" : "Log follow-up",
    cancelButtonLabel: "Cancel",
  });
  return confirmed ? data.createFollowUp(p) : undefined;
}
