import { z } from "zod";
import { DashboardFilters } from "./dashboard";
import { FetchXml, LogicalName, RecordId } from "./primitives";
import { CONTRACT_VERSION } from "./version";

/**
 * What the app tells the agent about the user's screen (App → agent).
 * Sent through `Xrm.Copilot.updateContext()`; the platform adds appId, appType,
 * orgId, geo and schemaVersion on its own.
 */
export const CollectionsContext = z.object({
  contractVersion: z.literal(CONTRACT_VERSION),
  entity: LogicalName,
  recordId: RecordId.optional(),
  customerNo: z.string().max(20).optional(),
  customerName: z.string().max(100).optional(),
  view: z.string().max(100).optional(),
  filterXML: FetchXml.optional(),
  overdueTotal: z.number().optional(),
  currency: z.string().length(3).optional(),
  dashboardId: RecordId.optional(),
  dashboardVersion: z.int().min(1).optional(),
  dashboardFilters: DashboardFilters.optional(),
});
export type CollectionsContext = z.infer<typeof CollectionsContext>;

/** The shape `Xrm.Copilot.updateContext` accepts (entity + filterXML, open for extras). */
export interface PowerAppsContent {
  entity: string;
  filterXML?: string;
  [key: string]: unknown;
}

/**
 * Maps our context onto PowerAppsContent.
 *
 * VERIFY: the reference documents `entity` and `filterXML`. Check in the tenant
 * whether extra keys (customerNo, overdueTotal, dashboardId…) reach a
 * *declarative* agent. If they are dropped, the `summary` line is what survives
 * in prompts (see buildGroundedPrompt), and the agent falls back to
 * calling `get_customer_context`.
 */
export function toPowerAppsContent(context: CollectionsContext): PowerAppsContent {
  const { entity, filterXML, ...rest } = CollectionsContext.parse(context);
  return { entity, ...(filterXML ? { filterXML } : {}), ...rest, summary: summarizeContext(context) };
}

/** One human-readable line, e.g. "Customer C-1001 Fabrikam, Inc. · view Overdue invoices · overdue EUR 91,250.00". */
export function summarizeContext(context: CollectionsContext): string {
  const parts: string[] = [];
  if (context.customerNo || context.customerName) {
    parts.push(`Customer ${[context.customerNo, context.customerName].filter(Boolean).join(" ")}`);
  }
  if (context.view) parts.push(`view ${context.view}`);
  if (context.overdueTotal !== undefined) {
    const amount = context.overdueTotal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    parts.push(["overdue", context.currency, amount].filter(Boolean).join(" "));
  }
  if (context.dashboardId) parts.push(`dashboard ${context.dashboardId} v${context.dashboardVersion ?? 1}`);
  return parts.join(" · ");
}

/**
 * Fallback for risk #1 (PLAN §7): put the context inside the prompt itself, so
 * the agent is grounded even if updateContext does not reach it.
 */
export function buildGroundedPrompt(prompt: string, context: CollectionsContext | undefined): string {
  if (!context) return prompt;
  return `${prompt}\n\n[App context] ${summarizeContext(context)}`;
}
