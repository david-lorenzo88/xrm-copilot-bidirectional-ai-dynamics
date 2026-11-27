import { z } from "zod";
import { DashboardSpec } from "./dashboard";
import { ContractVersionField, FetchXml, IsoDate, LogicalName, RecordId } from "./primitives";

/** Every action the app understands. The last two are built into model-driven apps. */
export const ActionIds = {
  OpenInvoices: "Contoso.Collections.OpenInvoices",
  ShowWorklist: "Contoso.Collections.ShowWorklist",
  RenderDashboard: "Contoso.Collections.RenderDashboard",
  LogFollowUp: "Contoso.Collections.LogFollowUp",
  ApplyCustomerChanges: "Contoso.Collections.ApplyCustomerChanges",
  CreateCustomer: "Contoso.Collections.CreateCustomer",
  OpenRecord: "MS.PA.CopilotChat.OpenRecord",
  NavigateToView: "MS.PA.CopilotChat.NavigateToView",
} as const;

export type ActionId = (typeof ActionIds)[keyof typeof ActionIds];

/** The actions this solution handles itself (built-ins stay with the platform). */
export const CUSTOM_ACTION_IDS = [
  ActionIds.OpenInvoices,
  ActionIds.ShowWorklist,
  ActionIds.RenderDashboard,
  ActionIds.LogFollowUp,
  ActionIds.ApplyCustomerChanges,
  ActionIds.CreateCustomer,
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

/** Business Central "Blocked" values ("" = not blocked). */
export const BLOCKED_VALUES = ["", "Ship", "Invoice", "All"] as const;
export type BlockedValue = (typeof BLOCKED_VALUES)[number];

/**
 * Agent proposes, the app fills the open form (unsaved), the user saves: the only fields Copilot may
 * change, and only on the customer the user has open. Saving writes through the virtual table to BC.
 */
export const ApplyCustomerChangesPayload = z.object({
  contractVersion: ContractVersionField,
  customerNo: z.string().min(1).max(20),
  changes: z
    .object({
      creditLimit: z.number().min(0).max(1_000_000_000).optional(),
      blocked: z.enum(BLOCKED_VALUES).optional(),
    })
    .strict()
    .refine((c) => c.creditLimit !== undefined || c.blocked !== undefined, { message: "No change proposed" }),
  reason: z.string().min(1).max(500),
});

/** A new BC customer as the app pre-fills it (lengths follow the BC customer API). */
export const NewCustomerFields = z
  .object({
    number: z.string().regex(/^[A-Z0-9-]{1,20}$/),
    name: z.string().min(1).max(100),
    addressLine1: z.string().max(100).optional(),
    city: z.string().max(30).optional(),
    postalCode: z.string().max(20).optional(),
    country: z.string().max(10).optional(),
    phoneNumber: z.string().max(30).optional(),
    email: z.string().email().max(80).optional(),
    website: z.string().max(80).optional(),
    taxRegistrationNumber: z.string().max(20).optional(),
    currencyCode: z.string().max(10).optional(),
    creditLimit: z.number().min(0).max(1_000_000_000).optional(),
  })
  .strict();
export type NewCustomerFields = z.infer<typeof NewCustomerFields>;

/** Agent proposes, the app opens a pre-filled new customer form, the user saves (which creates it in BC). */
export const CreateCustomerPayload = z.object({
  contractVersion: ContractVersionField,
  customer: NewCustomerFields,
  /** Where the data came from, e.g. "Email from Rita Sousa, 26 Nov". */
  source: z.string().min(1).max(300),
});

export const OpenRecordPayload = z.object({ entity: LogicalName, recordId: RecordId });
export const NavigateToViewPayload = z.object({ entity: LogicalName, fetchXml: FetchXml });

export const ActionPayloadSchemas = {
  [ActionIds.OpenInvoices]: OpenInvoicesPayload,
  [ActionIds.ShowWorklist]: ShowWorklistPayload,
  [ActionIds.RenderDashboard]: RenderDashboardPayload,
  [ActionIds.LogFollowUp]: LogFollowUpPayload,
  [ActionIds.ApplyCustomerChanges]: ApplyCustomerChangesPayload,
  [ActionIds.CreateCustomer]: CreateCustomerPayload,
  [ActionIds.OpenRecord]: OpenRecordPayload,
  [ActionIds.NavigateToView]: NavigateToViewPayload,
} as const satisfies Record<ActionId, z.ZodType>;

export type ActionPayload<A extends ActionId> = z.infer<(typeof ActionPayloadSchemas)[A]>;
export type OpenInvoicesPayload = ActionPayload<typeof ActionIds.OpenInvoices>;
export type ShowWorklistPayload = ActionPayload<typeof ActionIds.ShowWorklist>;
export type RenderDashboardPayload = ActionPayload<typeof ActionIds.RenderDashboard>;
export type LogFollowUpPayload = ActionPayload<typeof ActionIds.LogFollowUp>;
export type ApplyCustomerChangesPayload = ActionPayload<typeof ActionIds.ApplyCustomerChanges>;
export type CreateCustomerPayload = ActionPayload<typeof ActionIds.CreateCustomer>;
export type OpenRecordPayload = ActionPayload<typeof ActionIds.OpenRecord>;
export type NavigateToViewPayload = ActionPayload<typeof ActionIds.NavigateToView>;

export function isKnownActionId(id: unknown): id is ActionId {
  return typeof id === "string" && Object.values<string>(ActionIds).includes(id);
}
