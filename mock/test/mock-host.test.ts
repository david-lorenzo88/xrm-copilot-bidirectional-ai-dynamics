import { describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ActionIds, COPILOT_CHAT_ACTION_EVENT, type DashboardSpec } from "@collections/contract";
import { buildPrioritizedWorklistFetchXml } from "@collections/domain";
import { FIXTURE_AS_OF, fixtures } from "@collections/domain/fixtures";
import { MockRepository } from "@collections/mcp-server/mock-repository";
import { createCollectionsServer } from "@collections/mcp-server/server";
import { DEFAULT_SETTINGS, createCollectionsBridge, getCopilot } from "@collections/pcf-bridge/bridge";
import { FixtureDataService } from "@collections/pcf-bridge/testing";
import { ScriptedAgent, type PaneMessage } from "../src/copilot/agent";
import { FakeCopilot } from "../src/fake/copilot";
import { mda } from "../src/fake/mda-store";
import { installWidgetRelay, widgetWindows } from "../src/fake/relay";
import { MOCK_WORKLIST_VIEW_ID, builtInHandlers, createFakeXrm } from "../src/fake/xrm";

const INVOICE = fixtures.invoices.find((i) => i.totalAmount === 48_500)!;

describe("FakeCopilot", () => {
  it("merges the platform base fields into context and is a no-op when disabled", async () => {
    const copilot = new FakeCopilot();
    const events: string[] = [];
    copilot.on((e) => events.push(e.type));
    await copilot.updateContext({ entity: "dyn365bc_customer_v2_0", customerNo: "C-1001" });
    expect(copilot.context).toMatchObject({ entity: "dyn365bc_customer_v2_0", appType: "ModelDrivenApp", geo: "EU" });
    copilot.setEnabled(false);
    expect(await copilot.isM365CopilotEnabled()).toBe(false);
    await copilot.sendPromptToM365Copilot("hi");
    await copilot.deliverAction(ActionIds.OpenInvoices, {}, "widget");
    expect(events).toEqual(["context", "enabled"]);
  });

  it("runs multiple handlers sequentially and falls back to built-in defaults", async () => {
    const copilot = new FakeCopilot({ [ActionIds.OpenRecord]: vi.fn() });
    const order: string[] = [];
    copilot.addActionHandler("X", async () => void order.push("a"));
    copilot.addActionHandler("X", () => void order.push("b"));
    copilot.addActionHandler("Y", () => {
      throw new Error("boom");
    });
    const errors: string[] = [];
    copilot.on((e) => e.type === "action-error" && errors.push(e.error));
    await copilot.deliverAction("X", {}, "card");
    await copilot.deliverAction("Y", {}, "card");
    expect(order).toEqual(["a", "b"]);
    expect(errors).toEqual(["boom"]);
    await copilot.deliverAction(ActionIds.OpenRecord, {}, "widget"); // defaults off
    copilot.addDefaultActionHandlers();
    await copilot.deliverAction(ActionIds.OpenRecord, {}, "widget");
    expect(await copilot.getCurrentAgent()).toMatchObject({ name: "Collections (mock)" });
  });
});

describe("widget → host → handler relay", () => {
  it("routes powerapps.copilot.chat.action from known widget windows into the PCF handlers", async () => {
    const copilot = new FakeCopilot(builtInHandlers);
    copilot.addDefaultActionHandlers();
    const xrm = createFakeXrm(copilot);
    const data = new FixtureDataService();
    createCollectionsBridge({ copilot: getCopilot(xrm), sidePanes: xrm.App!.sidePanes, navigation: xrm.Navigation, data, settings: { ...DEFAULT_SETTINGS, worklistViewId: MOCK_WORKLIST_VIEW_ID }, today: () => FIXTURE_AS_OF });
    const uninstall = installWidgetRelay(copilot);
    const widget = {} as MessageEventSource;
    const message = { eventName: COPILOT_CHAT_ACTION_EVENT, action: ActionIds.OpenInvoices, actionData: { invoiceIds: [INVOICE.id], invoiceNumbers: [INVOICE.number] } };

    window.dispatchEvent(new MessageEvent("message", { data: message, source: widget as Window }));
    await new Promise((r) => setTimeout(r, 20));
    expect(mda.get().panes).toHaveLength(0); // unknown source → ignored

    widgetWindows.add(widget);
    window.dispatchEvent(new MessageEvent("message", { data: message, source: widget as Window }));
    window.dispatchEvent(new MessageEvent("message", { data: { jsonrpc: "2.0", method: "ui/notifications/size-changed" }, source: widget as Window }));
    await vi.waitFor(() => expect(mda.get().panes.map((p) => p.title)).toEqual([INVOICE.number]));
    expect(mda.get().panes[0]!.record).toEqual({ entityName: "dyn365bc_salesinvoice_v2_0", entityId: INVOICE.id });

    await copilot.deliverAction(ActionIds.ShowWorklist, { title: "Chase today", fetchXml: buildPrioritizedWorklistFetchXml([INVOICE.id]), invoiceIds: [INVOICE.id] }, "widget");
    expect(mda.get().grid).toEqual({ kind: "worklist", title: "Chase today" });

    // Built-in NavigateToView goes to the platform default (no custom handler registered for it).
    await copilot.deliverAction(ActionIds.NavigateToView, { entity: "dyn365bc_salesinvoice_v2_0", fetchXml: "<fetch/>" }, "widget");
    expect(mda.get().grid.kind).toBe("fetch");
    uninstall();
    widgetWindows.delete(widget);
  });
});

describe("ScriptedAgent against the real MCP server (in-memory)", () => {
  async function agent(context?: Record<string, unknown>, dashboards = new Map<string, DashboardSpec>()) {
    const server = createCollectionsServer({ repository: new MockRepository(undefined, dashboards), widgets: async () => "<html></html>" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "1" });
    await Promise.all([server.connect(b), client.connect(a)]);
    const messages: PaneMessage[] = [];
    const ag = new ScriptedAgent(client, (m) => messages.push(m), (id, p) => Object.assign(messages.find((m) => m.id === id)!, p), () => context as never);
    await ag.init();
    return { ag, messages };
  }

  it("beat 2: analyzes with tools and renders the priority-list widget", async () => {
    const { ag, messages } = await agent({ entity: "dyn365bc_customer_v2_0", customerNo: "C-1001" });
    await ag.handle("Analyze payment behavior");
    expect(messages.filter((m) => m.role === "tool").map((m) => (m as { name: string }).name)).toEqual(["analyze_payment_behavior", "prioritize_collections"]);
    expect(messages.find((m) => m.role === "widget")).toMatchObject({ resourceUri: "ui://collections/priority-list" });
    expect((messages.at(-1) as { text: string }).text).toMatch(/getting worse/);
  });

  it("falls back to the [App context] line when updateContext did not arrive", async () => {
    const { ag, messages } = await agent(undefined);
    await ag.handle("Analyze this customer\n\n[App context] Customer C-1002 Northwind Traders · view Overdue invoices");
    expect(messages.some((m) => m.role === "tool" && JSON.stringify(m.args).includes("C-1002"))).toBe(true);
  });

  it("beat 3: builds a dashboard, then reads the in-app change through the shared table", async () => {
    const dashboards = new Map<string, DashboardSpec>();
    const ctx: Record<string, unknown> = { entity: "dyn365bc_customer_v2_0", customerNo: "C-1001" };
    const { ag, messages } = await agent(ctx, dashboards);
    await ag.handle("Build me a dashboard of overdue by customer and aging bucket");
    const spec = [...dashboards.values()][0]!;
    expect(messages.find((m) => m.role === "widget")).toMatchObject({ resourceUri: "ui://collections/aging-dashboard" });
    dashboards.set(spec.id, { ...spec, version: 2, updatedBy: "app", filters: { bucketIds: ["90+"] } });
    ctx.dashboardId = spec.id;
    await ag.handle("What does the dashboard show now?");
    expect((messages.at(-1) as { text: string }).text).toMatch(/You changed it in the app: it's at v2, showing buckets 90\+/);
  });

  it("proposes follow-ups as a card and handles other intents", async () => {
    const { ag, messages } = await agent({ customerNo: "C-1001" });
    await ag.handle("Log a follow-up: promised to pay SI-104008 by 2026-12-04");
    expect(messages.at(-1)).toMatchObject({ role: "card", submit: { type: "PowerApps", action: ActionIds.LogFollowUp, actionData: { customerNo: "C-1001", promiseDate: "2026-12-04" } } });
    await ag.handle("Which customers drive the 90+ bucket?");
    expect((messages.at(-1) as { text: string }).text).toMatch(/Fabrikam/);
    await ag.handle("Tell me about this customer");
    expect((messages.at(-1) as { text: string }).text).toMatch(/Fabrikam, Inc\. \(C-1001\)/);
    ag.greet({ entity: "x", customerName: "Fabrikam, Inc.", overdueTotal: 10, currency: "EUR", view: "Overdue invoices" });
    expect((messages.at(-1) as { text: string }).text).toMatch(/I can see you're on \*\*Fabrikam/);
  });
});
