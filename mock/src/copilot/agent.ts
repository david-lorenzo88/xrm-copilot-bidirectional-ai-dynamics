import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { getToolUiResourceUri } from "@modelcontextprotocol/ext-apps/app-bridge";
import type { PowerAppsContent } from "@collections/contract";
import { addDays, type PaymentBehavior } from "@collections/domain";
import { FIXTURE_AS_OF } from "@collections/domain/fixtures";
import type { DashboardResult, PrioritizeResult } from "@collections/mcp-server/server-types";

export type PaneMessage =
  | { id: string; role: "user"; text: string; via: "app" | "typed" | "widget" }
  | { id: string; role: "agent"; text: string }
  | { id: string; role: "tool"; name: string; args: Record<string, unknown>; status: "running" | "done" | "error" }
  | { id: string; role: "widget"; resourceUri: string; toolName: string; args: Record<string, unknown>; result: CallToolResult }
  | { id: string; role: "system"; text: string; detail?: unknown };

let seq = 0;
export const msgId = () => `m${++seq}`;

const money = (n: number, ccy = "EUR") => new Intl.NumberFormat("en-IE", { style: "currency", currency: ccy }).format(n);

/**
 * A scripted stand-in for the declarative agent: deterministic intent matching,
 * but every number comes from a real MCP tool call, as the instructions demand.
 */
export class ScriptedAgent {
  private uiTools = new Map<string, string>();
  readonly modelContext: string[] = [];

  constructor(
    private readonly client: Client,
    private readonly post: (m: PaneMessage) => void,
    private readonly patch: (id: string, m: Partial<PaneMessage>) => void,
    private readonly context: () => PowerAppsContent | undefined,
  ) {}

  async init(): Promise<void> {
    const { tools } = await this.client.listTools();
    for (const t of tools) {
      const uri = getToolUiResourceUri(t);
      if (uri) this.uiTools.set(t.name, uri);
    }
  }

  private async call<T>(name: string, args: Record<string, unknown>): Promise<{ result: CallToolResult; data: T }> {
    const id = msgId();
    this.post({ id, role: "tool", name, args, status: "running" });
    const result = (await this.client.callTool({ name, arguments: args })) as CallToolResult;
    this.patch(id, { status: result.isError ? "error" : "done" });
    if (result.isError) throw new Error(result.content.map((c) => (c.type === "text" ? c.text : "")).join(" "));
    const uri = this.uiTools.get(name);
    if (uri) this.post({ id: msgId(), role: "widget", resourceUri: uri, toolName: name, args, result });
    return { result, data: result.structuredContent as T };
  }

  private say(text: string) {
    this.post({ id: msgId(), role: "agent", text });
  }

  /** Customer from updateContext, or from the [App context] line embedded in the prompt (fallback). */
  private customerNo(prompt: string): string | undefined {
    const ctx = this.context();
    if (typeof ctx?.customerNo === "string") return ctx.customerNo;
    return /\[App context\] Customer (\S+)/.exec(prompt)?.[1];
  }

  greet(ctx: PowerAppsContent): void {
    const name = (ctx.customerName as string | undefined) ?? (ctx.customerNo as string | undefined);
    const overdue = typeof ctx.overdueTotal === "number" ? ` with ${money(ctx.overdueTotal, (ctx.currency as string) ?? "EUR")} overdue` : "";
    this.say(`I can see you're on **${name}**${overdue}, in the "${ctx.view ?? "current"}" view. Ask me to analyze their payment behavior, or build a dashboard.`);
  }

  async handle(prompt: string): Promise<void> {
    const ask = prompt.split("[App context]")[0]!.trim();
    try {
      if (/follow.?up|promis/i.test(ask)) return await this.proposeFollowUp(ask, prompt);
      if (/dashboard/i.test(ask) && /(build|create|make|new)/i.test(ask)) return await this.buildDashboard();
      if (/dashboard/i.test(ask)) return await this.dashboardStatus();
      if (/90\+/.test(ask)) return await this.severe();
      if (/analy|behavio|chase|priorit/i.test(ask)) return await this.analyze(prompt);
      return await this.customerSummary(prompt);
    } catch (err) {
      this.say(`Sorry, that didn't work: ${(err as Error).message}`);
    }
  }

  private async analyze(prompt: string) {
    const customerNo = this.customerNo(prompt);
    if (!customerNo) return this.say("Which customer? Open a customer record or tell me the customer number.");
    const { data: b } = await this.call<PaymentBehavior>("analyze_payment_behavior", { customerNo });
    const { data: w } = await this.call<PrioritizeResult>("prioritize_collections", { customerNo, applyInApp: true });
    const critical = w.items.filter((i) => i.critical);
    const trend = b.trend === "worsening" ? `getting worse (+${b.trendDaysPerMonth} days late per month)` : b.trend;
    this.say(
      [
        `**${b.customerName}** pays ${b.avgDaysLate} days late on average and is ${trend}: ${b.recentAvgDaysLate} days in the last 3 months vs ${b.priorAvgDaysLate} before. Risk ${b.riskScore}/100 (${b.riskLevel}).`,
        `${money(b.overdueAmount, b.currency)} is overdue, ${money(b.severeOverdueAmount, b.currency)} of it for more than 60 days.`,
        critical.length
          ? `${critical.length} invoice(s) need a call today. I've opened them next to the form and put your list in chase order.`
          : "Nothing critical today.",
      ].join("\n\n"),
    );
  }

  private async severe() {
    const { data } = await this.call<PrioritizeResult>("prioritize_collections", { minDaysOverdue: 91, applyInApp: false });
    const names = [...new Set(data.items.map((i) => i.customerName))];
    this.say(names.length ? `The 90+ bucket is driven by ${names.join(", ")}. Start with ${data.items[0]!.invoiceNo} (${money(data.items[0]!.remainingAmount)}).` : "Nothing is more than 90 days overdue.");
  }

  private async buildDashboard() {
    const { data } = await this.call<DashboardResult>("build_aging_dashboard", { title: "Overdue by customer and aging bucket" });
    const top = data.data.rows[0];
    this.say(`Here's the dashboard (v${data.spec.version}). It's also open in the app. ${top ? `${top.label} leads with ${money(top.total.overdueAmount)} overdue.` : ""} Change a filter there and I'll see it.`);
  }

  private async dashboardStatus() {
    const ctx = this.context();
    const dashboardId = ctx?.dashboardId as string | undefined;
    if (!dashboardId) return this.buildDashboard();
    const { data } = await this.call<DashboardResult>("get_dashboard", { dashboardId });
    const who = data.spec.updatedBy === "app" ? "You changed it in the app" : "Unchanged since I built it";
    const filters = data.spec.filters.bucketIds?.length ? `buckets ${data.spec.filters.bucketIds.join(", ")}` : "all buckets";
    this.say(`${who}: it's at v${data.spec.version}, showing ${filters}. Total ${money(data.data.totals.overdueAmount)} overdue; top: ${data.data.rows.slice(0, 3).map((r) => `${r.label} ${money(r.total.overdueAmount)}`).join(", ")}.`);
  }

  private async customerSummary(prompt: string) {
    const customerNo = this.customerNo(prompt);
    if (!customerNo) return this.say("Open a customer and I'll pick up the context from the app.");
    const { result } = await this.call("get_customer_context", { customerNo });
    this.say(result.content.map((c) => (c.type === "text" ? c.text : "")).join("\n"));
  }

  /** Writes are proposed, never done: the tool's widget card hands the action to the app, which confirms. */
  private async proposeFollowUp(ask: string, prompt: string) {
    const customerNo = this.customerNo(prompt);
    if (!customerNo) return this.say("Which customer is the follow-up for?");
    const promiseDate = /(\d{4}-\d{2}-\d{2})/.exec(ask)?.[1] ?? addDays(FIXTURE_AS_OF, 7);
    const note = ask.replace(/^log (a )?follow.?up:?\s*/i, "");
    await this.call("propose_follow_up", { customerNo, note, promiseDate });
    this.say("I've prepared the follow-up. Nothing is logged until you send it to the app and confirm there.");
  }
}
