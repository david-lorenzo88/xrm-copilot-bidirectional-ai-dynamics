import { describe, expect, it } from "vitest";
import { ActionIds, CUSTOM_ACTION_IDS, createActionGuard, type DashboardSpec } from "@collections/contract";
import { WORKLIST_ENTITIES, type DashboardData, type PaymentBehavior } from "@collections/domain";
import { RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import type { PrioritizeResult } from "../src/tools/handlers";
import { WIDGETS } from "../src/widgets";
import { connect } from "./helpers";

const guard = createActionGuard({ allowed: CUSTOM_ACTION_IDS, allowedEntities: WORKLIST_ENTITIES });

describe("tool catalogue", () => {
  it("lists the six tools with readOnlyHint and widget links", async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    expect(Object.keys(byName).sort()).toEqual([
      "analyze_payment_behavior",
      "build_aging_dashboard",
      "get_customer_context",
      "get_dashboard",
      "prioritize_collections",
      "propose_follow_up",
      "update_dashboard",
    ]);
    for (const name of ["get_customer_context", "analyze_payment_behavior", "prioritize_collections", "get_dashboard", "propose_follow_up"]) {
      expect(byName[name]!.annotations?.readOnlyHint, name).toBe(true);
    }
    expect(byName.build_aging_dashboard!.annotations?.readOnlyHint).toBe(false);
    expect(byName.prioritize_collections!._meta).toMatchObject({ ui: { resourceUri: WIDGETS.priorityList.uri } });
    expect(byName.build_aging_dashboard!._meta).toMatchObject({ ui: { resourceUri: WIDGETS.agingDashboard.uri } });
    expect(byName.get_customer_context!._meta).toBeUndefined();
  });

  it("serves both widgets as MCP App resources", async () => {
    const { client } = await connect();
    const { resources } = await client.listResources();
    expect(resources.map((r) => r.uri).sort()).toEqual([WIDGETS.agingDashboard.uri, WIDGETS.priorityList.uri]);
    const read = await client.readResource({ uri: WIDGETS.priorityList.uri });
    expect(read.contents[0]).toMatchObject({ uri: WIDGETS.priorityList.uri, mimeType: RESOURCE_MIME_TYPE });
    expect(RESOURCE_MIME_TYPE).toBe("text/html;profile=mcp-app");
  });
});

describe("customer tools", () => {
  it("get_customer_context grounds Fabrikam", async () => {
    const { call } = await connect();
    const r = await call<{ customer: { name: string }; aging: { overdueAmount: number }; context: { filterXML: string }; topOverdue: { daysOverdue: number }[] }>(
      "get_customer_context",
      { customerNo: "C-1001" },
    );
    expect(r.isError).toBeFalsy();
    expect(r.data.customer.name).toBe("Fabrikam, Inc.");
    expect(r.data.aging.overdueAmount).toBeGreaterThan(48_500);
    expect(r.data.topOverdue[0]!.daysOverdue).toBe(100);
    expect(r.data.context.filterXML).toContain("C-1001");
    expect(r.text).toMatch(/Fabrikam, Inc\. \(C-1001\)/);
  });

  it("accepts a name prefix and reports unknown customers as tool errors", async () => {
    const { call } = await connect();
    expect((await call("get_customer_context", { customerNo: "fabrikam" })).isError).toBeFalsy();
    const missing = await call("get_customer_context", { customerNo: "Nobody Ltd" });
    expect(missing.isError).toBe(true);
    expect(missing.text).toMatch(/Customer not found/);
  });

  it("analyze_payment_behavior finds the worsening trend", async () => {
    const { call } = await connect();
    const r = await call<PaymentBehavior>("analyze_payment_behavior", { customerNo: "C-1001" });
    expect(r.data).toMatchObject({ trend: "worsening", riskLevel: "high" });
    expect(r.text).toMatch(/Trend worsening/);
    const improving = await call<PaymentBehavior>("analyze_payment_behavior", { customerNo: "Tailspin", lookbackMonths: 12 });
    expect(improving.data.trend).toBe("improving");
  });

  it("validates input schemas", async () => {
    const { call } = await connect();
    const r = await call("analyze_payment_behavior", { customerNo: "C-1001", lookbackMonths: 99 });
    expect(r.isError).toBe(true);
  });
});

describe("prioritize_collections", () => {
  it("returns a ranked list plus app actions that pass the app's allow-list", async () => {
    const { call } = await connect();
    const r = await call<PrioritizeResult>("prioritize_collections", { customerNo: "C-1001" });
    expect(r.data.items[0]).toMatchObject({ invoiceNo: expect.any(String), remainingAmount: 48_500, critical: true });
    expect(r.data.autoApply).toBe(true);
    const open = guard.parse(ActionIds.OpenInvoices, r.data.actions.openInvoices);
    const worklist = guard.parse(ActionIds.ShowWorklist, r.data.actions.showWorklist);
    expect(open.ok && worklist.ok).toBe(true);
    expect(r.data.actions.showWorklist!.title).toBe("Chase today: Fabrikam, Inc.");
    expect(r.text).toMatch(/CRITICAL/);
  });

  it("works across all customers and with nothing to chase", async () => {
    const { call } = await connect();
    const all = await call<PrioritizeResult>("prioritize_collections", { limit: 5, applyInApp: false });
    expect(all.data.items).toHaveLength(5);
    expect(all.data.autoApply).toBe(false);
    expect(new Set(all.data.items.map((i) => i.customerNo)).size).toBeGreaterThan(1);
    const none = await call<PrioritizeResult>("prioritize_collections", { customerNo: "C-1004" });
    expect(none.data.items).toEqual([]);
    expect(none.data.actions).toEqual({ openInvoices: null, showWorklist: null });
  });
});

describe("dashboard tools (shared state)", () => {
  type Dash = { spec: DashboardSpec; data: DashboardData; overwroteNewerVersion?: boolean };

  it("build → get → update with last-write-wins versioning", async () => {
    const { call } = await connect();
    const built = await call<Dash>("build_aging_dashboard", { title: "Overdue by customer and aging bucket" });
    expect(built.isError).toBeFalsy();
    const { spec } = built.data;
    expect(spec).toMatchObject({ version: 1, updatedBy: "agent", groupBy: ["customer", "agingBucket"] });
    expect(built.data.data.rows[0]!.label).toBe("Fabrikam, Inc.");
    expect(guard.parse(ActionIds.RenderDashboard, { dashboardId: spec.id, spec }).ok).toBe(true);

    const got = await call<Dash>("get_dashboard", { dashboardId: spec.id });
    expect(got.data.spec).toEqual(spec);

    const updated = await call<Dash>("update_dashboard", { dashboardId: spec.id, expectedVersion: 1, patch: { filters: { bucketIds: ["61-90", "90+"] } } });
    expect(updated.data.spec.version).toBe(2);
    expect(updated.data.data.columns.map((c) => c.key)).toEqual(["61-90", "90+"]);
    expect(updated.data.overwroteNewerVersion).toBeUndefined();

    const stale = await call<Dash>("update_dashboard", { dashboardId: spec.id, expectedVersion: 1, patch: { title: "Severe only" } });
    expect(stale.data.spec.version).toBe(3);
    expect(stale.data.overwroteNewerVersion).toBe(true);
    expect(stale.text).toMatch(/last write wins/);

    const revised = await call<Dash>("build_aging_dashboard", { dashboardId: spec.id, visual: "table" });
    expect(revised.data.spec).toMatchObject({ version: 4, visual: "table", title: "Severe only" });
  });

  it("supports custom grouping and reports missing dashboards", async () => {
    const { call } = await connect();
    const r = await call<Dash>("build_aging_dashboard", { groupBy: ["salesperson", "agingBucket"], measures: ["invoiceCount"], filters: { minAmount: 1000 } });
    expect(r.data.data.measure).toBe("invoiceCount");
    const missing = await call("get_dashboard", { dashboardId: "0f8fad5b-d9cb-469f-a165-70867728950e" });
    expect(missing.isError).toBe(true);
    const missingUpdate = await call("update_dashboard", { dashboardId: "0f8fad5b-d9cb-469f-a165-70867728950e", patch: {} });
    expect(missingUpdate.isError).toBe(true);
  });
});

describe("propose_follow_up", () => {
  it("proposes a LogFollowUp payload the app accepts, and writes nothing", async () => {
    const { call } = await connect();
    const r = await call<{ kind: string; payload: unknown; actionId: string }>("propose_follow_up", { customerNo: "fabrikam", note: "Promised to pay SI-104008", promiseDate: "2026-12-04", promisedAmount: 48500 });
    expect(r.data.kind).toBe("followUpProposal");
    expect(r.data.actionId).toBe(ActionIds.LogFollowUp);
    expect(guard.parse(ActionIds.LogFollowUp, r.data.payload)).toMatchObject({ ok: true, data: { customerNo: "C-1001", promiseDate: "2026-12-04" } });
    expect(r.text).toMatch(/Nothing is logged yet/);
    expect((await call("propose_follow_up", { customerNo: "C-1001", note: "x", promiseDate: "next week" })).isError).toBe(true);
  });
});
