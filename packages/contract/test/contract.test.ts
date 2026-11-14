import { describe, expect, it } from "vitest";
import {
  ActionIds,
  COPILOT_CHAT_ACTION_EVENT,
  CUSTOM_ACTION_IDS,
  DEFAULT_AGING_BUCKETS,
  DashboardSpec,
  applyDashboardPatch,
  buildGroundedPrompt,
  createActionGuard,
  createAdaptiveCardSubmitData,
  createChatActionMessage,
  createDashboardSpec,
  fetchXmlEntityName,
  isCompatibleVersion,
  isCopilotChatActionMessage,
  isNewerSpec,
  parseIncomingAction,
  toPowerAppsContent,
  type CollectionsContext,
} from "../src";

const INVOICE = "dyn365bc_salesinvoice_v2_0";
const ID1 = "0f8fad5b-d9cb-469f-a165-70867728950e";
const ID2 = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const FETCH = `<fetch top="50"><entity name="${INVOICE}"><attribute name="dyn365bc_number"/></entity></fetch>`;

const guard = createActionGuard({ allowed: CUSTOM_ACTION_IDS, allowedEntities: [INVOICE] });

describe("action allow-list", () => {
  it("accepts a valid OpenInvoices payload", () => {
    const r = guard.parse(ActionIds.OpenInvoices, { invoiceIds: [ID1, ID2], invoiceNumbers: ["SI-1", "SI-2"] });
    expect(r.ok).toBe(true);
    if (r.ok && r.action === ActionIds.OpenInvoices) expect(r.data.invoiceIds).toHaveLength(2);
  });

  it("rejects actions that are not on the allow-list", () => {
    expect(guard.parse(ActionIds.OpenRecord, { entity: INVOICE, recordId: ID1 })).toMatchObject({ ok: false, error: "action not allowed" });
    expect(guard.parse("Evil.DeleteEverything", {})).toMatchObject({ ok: false });
    expect(guard.parse(42, {})).toMatchObject({ ok: false, action: "42" });
    expect(guard.isAllowed(ActionIds.ShowWorklist)).toBe(true);
    expect(guard.isAllowed(ActionIds.NavigateToView)).toBe(false);
  });

  it("rejects malformed payloads with a readable error", () => {
    const r = guard.parse(ActionIds.OpenInvoices, { invoiceIds: ["not-a-guid"] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/invoiceIds\.0/);
    expect(guard.parse(ActionIds.OpenInvoices, { invoiceIds: [] }).ok).toBe(false);
    expect(guard.parse(ActionIds.OpenInvoices, { invoiceIds: Array(6).fill(ID1) }).ok).toBe(false);
    expect(guard.parse(ActionIds.OpenInvoices, null).ok).toBe(false);
  });

  it("guards FetchXML to allowed entities", () => {
    expect(guard.parse(ActionIds.ShowWorklist, { title: "Chase today", fetchXml: FETCH }).ok).toBe(true);
    const other = FETCH.replace(INVOICE, "systemuser");
    expect(guard.parse(ActionIds.ShowWorklist, { title: "x", fetchXml: other })).toMatchObject({ ok: false, error: "entity not allowed: systemuser" });
    expect(guard.parse(ActionIds.ShowWorklist, { title: "x", fetchXml: "<script/>" }).ok).toBe(false);
  });

  it("checks built-in action entities when they are allowed", () => {
    const g = createActionGuard({ allowed: [ActionIds.OpenRecord, ActionIds.NavigateToView], allowedEntities: [INVOICE] });
    expect(g.parse(ActionIds.OpenRecord, { entity: INVOICE, recordId: ID1 }).ok).toBe(true);
    expect(g.parse(ActionIds.OpenRecord, { entity: "account", recordId: ID1 }).ok).toBe(false);
    expect(g.parse(ActionIds.NavigateToView, { entity: INVOICE, fetchXml: FETCH }).ok).toBe(true);
  });

  it("works without an entity policy", () => {
    expect(parseIncomingAction(ActionIds.ShowWorklist, { title: "x", fetchXml: FETCH.replace(INVOICE, "account") }, { allowed: CUSTOM_ACTION_IDS }).ok).toBe(true);
  });

  it("validates LogFollowUp and RenderDashboard", () => {
    expect(guard.parse(ActionIds.LogFollowUp, { customerNo: "C-1001", note: "Promised payment", promiseDate: "2026-12-04" }).ok).toBe(true);
    expect(guard.parse(ActionIds.LogFollowUp, { customerNo: "C-1001", note: "", promiseDate: "tomorrow" }).ok).toBe(false);
    const spec = createDashboardSpec({ id: ID1 });
    expect(guard.parse(ActionIds.RenderDashboard, { dashboardId: ID1 }).ok).toBe(true);
    expect(guard.parse(ActionIds.RenderDashboard, { spec }).ok).toBe(true);
    expect(guard.parse(ActionIds.RenderDashboard, {}).ok).toBe(false);
    expect(guard.parse(ActionIds.RenderDashboard, { dashboardId: ID2, spec }).ok).toBe(false);
  });

  it("rejects an incompatible contract major version", () => {
    expect(guard.parse(ActionIds.OpenInvoices, { contractVersion: "1.4", invoiceIds: [ID1] }).ok).toBe(true);
    expect(guard.parse(ActionIds.OpenInvoices, { contractVersion: "2.0", invoiceIds: [ID1] }).ok).toBe(false);
    expect(isCompatibleVersion(undefined)).toBe(true);
    expect(isCompatibleVersion("x")).toBe(false);
  });
});

describe("chat action messages", () => {
  it("builds the widget postMessage envelope", () => {
    const msg = createChatActionMessage(ActionIds.OpenInvoices, { invoiceIds: [ID1] });
    expect(msg).toEqual({ eventName: COPILOT_CHAT_ACTION_EVENT, action: ActionIds.OpenInvoices, actionData: { invoiceIds: [ID1] } });
    expect(isCopilotChatActionMessage(msg)).toBe(true);
    expect(isCopilotChatActionMessage({ eventName: "other", action: ActionIds.OpenInvoices, actionData: {} })).toBe(false);
    expect(isCopilotChatActionMessage({ eventName: COPILOT_CHAT_ACTION_EVENT, action: "x", actionData: {} })).toBe(false);
    expect(isCopilotChatActionMessage("str")).toBe(false);
  });

  it("refuses to build invalid messages", () => {
    expect(() => createChatActionMessage(ActionIds.OpenInvoices, { invoiceIds: [] })).toThrow();
  });

  it("builds Adaptive Card submit data", () => {
    expect(createAdaptiveCardSubmitData(ActionIds.ShowWorklist, { title: "t", fetchXml: FETCH })).toMatchObject({ type: "PowerApps", action: ActionIds.ShowWorklist });
  });
});

describe("dashboard spec", () => {
  const now = new Date("2026-11-27T09:00:00Z");

  it("creates a valid default spec", () => {
    const spec = createDashboardSpec({ id: ID1, now });
    expect(spec.groupBy).toEqual(["customer", "agingBucket"]);
    expect(spec.buckets).toHaveLength(5);
    expect(spec.version).toBe(1);
    expect(DashboardSpec.safeParse(spec).success).toBe(true);
  });

  it("rejects overlapping buckets and identical dimensions", () => {
    const base = createDashboardSpec({ id: ID1, now });
    const overlapping = { ...base, buckets: [{ id: "a", label: "A", minDays: 0, maxDays: 30 }, { id: "b", label: "B", minDays: 30, maxDays: null }] };
    expect(DashboardSpec.safeParse(overlapping).success).toBe(false);
    const openEndedFirst = { ...base, buckets: [{ id: "a", label: "A", minDays: 0, maxDays: null }, { id: "b", label: "B", minDays: 10, maxDays: 20 }] };
    expect(DashboardSpec.safeParse(openEndedFirst).success).toBe(false);
    const inverted = { ...base, buckets: [{ id: "a", label: "A", minDays: 10, maxDays: 5 }] };
    expect(DashboardSpec.safeParse(inverted).success).toBe(false);
    expect(DashboardSpec.safeParse({ ...base, groupBy: ["customer", "customer"] }).success).toBe(false);
  });

  it("patches, bumps version and replaces filters", () => {
    const spec = createDashboardSpec({ id: ID1, now, filters: { minAmount: 100 } });
    const next = applyDashboardPatch(spec, { filters: { bucketIds: ["61-90", "90+"] } }, "app", new Date("2026-11-27T10:00:00Z"));
    expect(next.version).toBe(2);
    expect(next.updatedBy).toBe("app");
    expect(next.filters).toEqual({ bucketIds: ["61-90", "90+"] });
    expect(applyDashboardPatch(next, { title: "t" }, "agent").filters).toEqual(next.filters);
    expect(isNewerSpec(next, spec)).toBe(true);
    expect(isNewerSpec(spec, next)).toBe(false);
    expect(isNewerSpec(spec, undefined)).toBe(true);
    expect(isNewerSpec({ ...spec, updatedAt: "2026-11-28T00:00:00.000Z" }, spec)).toBe(true);
  });

  it("default buckets cover the standard aging ranges", () => {
    expect(DEFAULT_AGING_BUCKETS.map((b) => b.label)).toEqual(["Current", "1–30", "31–60", "61–90", "90+"]);
  });
});

describe("context", () => {
  const ctx: CollectionsContext = {
    contractVersion: "1.0",
    entity: "dyn365bc_customer_v2_0",
    recordId: ID1,
    customerNo: "C-1001",
    customerName: "Fabrikam, Inc.",
    view: "Overdue invoices",
    filterXML: FETCH,
    overdueTotal: 91250,
    currency: "EUR",
  };

  it("maps onto PowerAppsContent with a summary", () => {
    const content = toPowerAppsContent(ctx);
    expect(content.entity).toBe("dyn365bc_customer_v2_0");
    expect(content.filterXML).toBe(FETCH);
    expect(content.customerNo).toBe("C-1001");
    expect(content.summary).toBe("Customer C-1001 Fabrikam, Inc. · view Overdue invoices · overdue EUR 91,250.00");
  });

  it("omits filterXML when absent and rejects bad context", () => {
    const { filterXML: _f, ...noFilter } = ctx;
    expect("filterXML" in toPowerAppsContent(noFilter)).toBe(false);
    expect(() => toPowerAppsContent({ ...ctx, entity: "Bad Name" })).toThrow();
  });

  it("embeds context into prompts as a fallback", () => {
    expect(buildGroundedPrompt("Analyze", undefined)).toBe("Analyze");
    expect(buildGroundedPrompt("Analyze", { ...ctx, dashboardId: ID2, dashboardVersion: 3 })).toContain(`dashboard ${ID2} v3`);
  });

  it("names the customer in plain words when the prompt has a {customer} placeholder", () => {
    expect(buildGroundedPrompt("Analyze the payment behavior of {customer}.", ctx)).toBe("Analyze the payment behavior of Fabrikam, Inc. (C-1001).");
    expect(buildGroundedPrompt("Check {customer}.", { ...ctx, dashboardId: ID2, dashboardVersion: 2 })).toBe(`Check Fabrikam, Inc. (C-1001). The open dashboard is ${ID2} (v2).`);
    expect(buildGroundedPrompt("Check {customer}.", undefined)).toBe("Check this customer.");
  });

  it("extracts the FetchXML entity", () => {
    expect(fetchXmlEntityName(FETCH)).toBe(INVOICE);
    expect(fetchXmlEntityName("<fetch/>")).toBeUndefined();
  });
});
