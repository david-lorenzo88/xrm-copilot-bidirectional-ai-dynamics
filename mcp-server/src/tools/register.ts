import { z } from "zod";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { DashboardDimension, DashboardFilters, DashboardMeasure, IsoDate, RecordId } from "@collections/contract";
import type { CollectionsRepository } from "../repository/types";
import { WIDGETS } from "../widgets";
import * as h from "./handlers";
import { summarizeBehavior, summarizeContext, summarizeDashboard, summarizeFollowUp, summarizeWorklist } from "./summaries";

const customerNo = z.string().min(1).max(100).describe("Business Central customer number (e.g. C-1001) or the start of the customer name");
const groupBy = z.tuple([DashboardDimension, DashboardDimension]).describe('[rows, columns], default ["customer","agingBucket"]');
const visual = z.enum(["stackedBar", "table", "both"]);

/** Wraps a handler: structured content for the widget, a text summary for the model, errors as isError. */
function respond<T extends object>(run: () => Promise<T>, summarize: (r: T) => string): Promise<CallToolResult> {
  return run().then(
    (result) => ({ content: [{ type: "text", text: summarize(result) }], structuredContent: result as Record<string, unknown> }),
    (err: Error) => ({ content: [{ type: "text", text: err.message }], isError: true }),
  );
}

export function registerTools(server: McpServer, repo: CollectionsRepository): void {
  server.registerTool(
    "get_customer_context",
    {
      title: "Get customer context",
      description:
        "Customer header, aging summary, risk snapshot and the top overdue invoices. Call this first when the app context names a customer, or to ground any answer about a customer.",
      inputSchema: { customerNo: customerNo.optional(), customerId: RecordId.optional().describe("Dataverse record id of the customer") },
      annotations: { readOnlyHint: true },
    },
    (args) => respond(() => h.getCustomerContext(repo, args), summarizeContext),
  );

  server.registerTool(
    "analyze_payment_behavior",
    {
      title: "Analyze payment behavior",
      description: "Average days late, trend (improving/stable/worsening), risk score 0–100 and the signals behind it, computed from invoice and payment history.",
      inputSchema: { customerNo, lookbackMonths: z.int().min(3).max(24).optional().describe("Default 12") },
      annotations: { readOnlyHint: true },
    },
    (args) => respond(() => h.analyzeBehavior(repo, args), summarizeBehavior),
  );

  // ── Tools with a UI: _meta.ui.resourceUri links the result to a ui:// widget ──
  registerAppTool(
    server,
    "prioritize_collections",
    {
      title: "Prioritize collections",
      description:
        "Ranked chase-today worklist of overdue invoices (one customer or all). Renders the priority-list widget, which opens the critical invoices and the worklist in the app.",
      inputSchema: {
        customerNo: customerNo.optional(),
        limit: z.int().min(1).max(50).optional(),
        minDaysOverdue: z.int().min(0).max(365).optional(),
        applyInApp: z.boolean().optional().describe("Show the chase-today worklist in the app straight away (default true; navigation only). Critical invoices open in side panes only when the user clicks in the widget"),
      },
      annotations: { readOnlyHint: true },
      _meta: { ui: { resourceUri: WIDGETS.priorityList.uri } },
    },
    (args) => respond(() => h.prioritize(repo, args), summarizeWorklist),
  );

  registerAppTool(
    server,
    "propose_follow_up",
    {
      title: "Propose follow-up",
      description:
        "Proposes logging a collection follow-up (note, promise-to-pay date, amount). Writes nothing: it renders a card the user can send to the app, where they confirm before anything is stored.",
      inputSchema: {
        customerNo,
        note: z.string().min(1).max(2000),
        promiseDate: IsoDate.optional().describe("YYYY-MM-DD"),
        promisedAmount: z.number().min(0).optional(),
      },
      annotations: { readOnlyHint: true },
      _meta: { ui: { resourceUri: WIDGETS.priorityList.uri } },
    },
    (args) => respond(() => h.proposeFollowUp(repo, args), summarizeFollowUp),
  );

  registerAppTool(
    server,
    "propose_research_note",
    {
      title: "Propose research note",
      description:
        "After a web search about a customer's context (sector, country, late-payment trends, insolvencies, regulation), proposes inserting a short summary with its sources into the customer's record. Writes nothing: it renders a card the user sends to the app, where they confirm before anything is stored.",
      inputSchema: {
        customerNo,
        summary: z.string().min(1).max(2000).describe("Plain-text summary for a collections specialist: 4-8 short bullet lines, each with the fact and why it matters"),
        sources: z.array(z.object({ title: z.string().min(1).max(200), url: z.string().url().max(500) })).max(8).optional().describe("The web pages the summary relies on"),
      },
      annotations: { readOnlyHint: true },
      _meta: { ui: { resourceUri: WIDGETS.priorityList.uri } },
    },
    (args) => respond(() => h.proposeResearchNote(repo, args), summarizeFollowUp),
  );

  registerAppTool(
    server,
    "build_aging_dashboard",
    {
      title: "Build aging dashboard",
      description:
        "Creates (or replaces) a dashboard spec, e.g. overdue by customer and aging bucket, stores it and returns spec + data. Renders the aging-dashboard widget, which also shows it inside the app.",
      inputSchema: {
        title: z.string().max(120).optional(),
        groupBy: groupBy.optional(),
        measures: z.array(DashboardMeasure).min(1).max(3).optional(),
        filters: DashboardFilters.optional(),
        visual: visual.optional(),
        dashboardId: RecordId.optional().describe("Pass to revise an existing dashboard"),
      },
      annotations: { readOnlyHint: false },
      _meta: { ui: { resourceUri: WIDGETS.agingDashboard.uri } },
    },
    (args) => respond(() => h.buildDashboard(repo, args), summarizeDashboard),
  );

  registerAppTool(
    server,
    "get_dashboard",
    {
      title: "Get dashboard",
      description:
        "Current spec and data of a stored dashboard, re-rendered here. Call it before saying anything about a dashboard: the user may have changed it in the app since it was rendered in the chat (the version and updatedBy tell). Without dashboardId it returns the most recently changed dashboard.",
      inputSchema: { dashboardId: RecordId.optional() },
      annotations: { readOnlyHint: true },
      _meta: { ui: { resourceUri: WIDGETS.agingDashboard.uri } },
    },
    (args) => respond(() => h.getDashboard(repo, args.dashboardId), summarizeDashboard),
  );

  registerAppTool(
    server,
    "update_dashboard",
    {
      title: "Update dashboard",
      description: "Patches a stored dashboard (title, grouping, visual; `filters` replaces the whole filter set). Last write wins; the version increments. Also called by the widget when the user changes a filter.",
      inputSchema: {
        dashboardId: RecordId,
        expectedVersion: z.int().min(1).optional(),
        patch: z.object({
          title: z.string().max(120).optional(),
          groupBy: groupBy.optional(),
          measures: z.array(DashboardMeasure).min(1).max(3).optional(),
          filters: DashboardFilters.optional(),
          visual: visual.optional(),
        }),
      },
      annotations: { readOnlyHint: false },
      _meta: { ui: { resourceUri: WIDGETS.agingDashboard.uri } },
    },
    (args) => respond(() => h.updateDashboard(repo, args), summarizeDashboard),
  );
}
