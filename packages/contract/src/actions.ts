import { z } from "zod";
import { DashboardSpec } from "./dashboard";
import { ContractVersionField, FetchXml, IsoDate, LogicalName, RecordId } from "./primitives";

/** Every action the app understands. The last two are built into model-driven apps. */
export const ActionIds = {
  OpenInvoices: "Contoso.Collections.OpenInvoices",
  ShowWorklist: "Contoso.Collections.ShowWorklist",
  RenderDashboard: "Contoso.Collections.RenderDashboard",
  LogFollowUp: "Contoso.Collections.LogFollowUp",
  OpenRecord: "MS.PA.CopilotChat.OpenRecord",
  NavigateToView: "MS.PA.CopilotChat.NavigateToView",
} as const;

export type ActionId = (typeof ActionIds)[keyof typeof ActionIds];

/** The four actions this solution handles itself (built-ins stay with the platform). */
export const CUSTOM_ACTION_IDS = [
  ActionIds.OpenInvoices,
  ActionIds.ShowWorklist,
  ActionIds.RenderDashboard,
  ActionIds.LogFollowUp,
] as const;
export type CustomActionId = (typeof CUSTOM_ACTION_IDS)[number];

/** Upper bound on side panes opened by one action (keeps the UI usable). */
export const MAX_SIDE_PANES = 5;

export const OpenInvoicesPayload = z.object({
  contractVersion: ContractVersionField,
  invoiceIds: z.array(RecordId).min(1).max(MAX_SIDE_PANES),
  /** Optional display numbers, same order as invoiceIds, used as pane titles. */
  invoiceNumbers: z.array(z.string().max(40)).max(MAX_SIDE_PANES).optional(),
});

export const ShowWorklistPayload = z.object({
  contractVersion: ContractVersionField,
  title: z.string().min(1).max(100),
  fetchXml: FetchXml,
  /** Priority order (FetchXML can't express an arbitrary order). */
  invoiceIds: z.array(RecordId).max(50).optional(),
  /** The agent's next step per invoice, same order as invoiceIds, so the app shows the same advice as the widget. */
  suggestedActions: z.array(z.enum(["Call today", "Send reminder", "Monitor"])).max(50).optional(),
});

export const RenderDashboardPayload = z
  .object({
    contractVersion: ContractVersionField,
    dashboardId: RecordId.optional(),
    spec: DashboardSpec.optional(),
  })
  .refine((p) => p.dashboardId !== undefined || p.spec !== undefined, "dashboardId or spec is required")
  .refine((p) => !p.dashboardId || !p.spec || p.spec.id === p.dashboardId, "dashboardId must match spec.id");

export const LogFollowUpPayload = z.object({
  contractVersion: ContractVersionField,
  customerNo: z.string().min(1).max(20),
  note: z.string().min(1).max(2000),
  promiseDate: IsoDate.optional(),
  promisedAmount: z.number().min(0).optional(),
  invoiceIds: z.array(RecordId).max(20).optional(),
  /** "research": a web-research note the agent proposed (stored the same way, labelled differently). */
  kind: z.enum(["followUp", "research"]).optional(),
  /** Web sources behind a research note. */
  sources: z.array(z.object({ title: z.string().min(1).max(200), url: z.string().url().max(500) })).max(8).optional(),
});

export const OpenRecordPayload = z.object({ entity: LogicalName, recordId: RecordId });
export const NavigateToViewPayload = z.object({ entity: LogicalName, fetchXml: FetchXml });

export const ActionPayloadSchemas = {
  [ActionIds.OpenInvoices]: OpenInvoicesPayload,
  [ActionIds.ShowWorklist]: ShowWorklistPayload,
  [ActionIds.RenderDashboard]: RenderDashboardPayload,
  [ActionIds.LogFollowUp]: LogFollowUpPayload,
  [ActionIds.OpenRecord]: OpenRecordPayload,
  [ActionIds.NavigateToView]: NavigateToViewPayload,
} as const satisfies Record<ActionId, z.ZodType>;

export type ActionPayload<A extends ActionId> = z.infer<(typeof ActionPayloadSchemas)[A]>;
export type OpenInvoicesPayload = ActionPayload<typeof ActionIds.OpenInvoices>;
export type ShowWorklistPayload = ActionPayload<typeof ActionIds.ShowWorklist>;
export type RenderDashboardPayload = ActionPayload<typeof ActionIds.RenderDashboard>;
export type LogFollowUpPayload = ActionPayload<typeof ActionIds.LogFollowUp>;
export type OpenRecordPayload = ActionPayload<typeof ActionIds.OpenRecord>;
export type NavigateToViewPayload = ActionPayload<typeof ActionIds.NavigateToView>;

export function isKnownActionId(id: unknown): id is ActionId {
  return typeof id === "string" && Object.values<string>(ActionIds).includes(id);
}
