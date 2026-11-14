# Demo script: three beats (about 12 minutes)

Live tenant: app **Collections Workspace** on `premium-us`, Business Central **CRONUS ES** (environment
*Production*) through virtual tables, agent **Collections** set as the app's default agent.

Hero customer: **Fabrikam, Inc. (DEMO-C-1001)**. With the demo date `DEMO_AS_OF=2026-11-27` (the session
day) the live tenant shows:

| What | Value |
|---|---|
| Open balance | **€73,588.52** across 4 open invoices |
| Worst invoice | **103304, €48,499.99, 100 days overdue (90+)**, ranked #1, *Call today* |
| Payment behaviour | **39.7 days late** on average, **worsening** (+3.8 days/month; recent 44 vs prior 37.5), risk **82**/100 |
| Whole demo book (25 `DEMO-C-*` customers) | 300 invoices posted, 269 paid and closed, 31 open (€221,327.21) |

Other open Fabrikam invoices: 103306 (€8,604.52), 103307 (€9,628.45) and 103308 (posted 22 Nov).
The beats don't depend on exact numbers, but these are what you should see on stage.

The *Overdue invoices* view and its sub-grid use the **real** date (a view filter can't take a demo date).
Only the agent's numbers and the PCF use `DEMO_AS_OF`. Before 27 Nov the sub-grid shows fewer overdue rows
than the agent reports; on the day they match.

Screenshots in `docs/img/` come from the mock host (fixture numbers such as SI-104008), not the tenant.

## Before you go on stage

- [ ] Signed in as the demo user (M365 Copilot licence). Collections Workspace open on the sitemap, Copilot pane closed.
- [ ] Open Fabrikam once in the last 30 minutes, so the `isM365CopilotEnabled()` cache is warm, and close it again.
- [ ] MCP server healthy (it runs with min replicas 1, so no cold start):
  ```bash
  curl -s "$(grep ^PUBLIC_BASE_URL deploy/outputs.env | cut -d= -f2)/healthz"
  ```
  Expect `"status":"ok"`, `"dataMode":"dataverse"`, `"authMode":"entra"`.
- [ ] One throwaway prompt to the agent from the app (any customer), so SSO consent and the token are cached.
- [ ] No old Fabrikam dashboard: delete Fabrikam rows in *Collection dashboards*, or accept that Beat 3 starts at a higher version.
- [ ] Side panes from the rehearsal closed.
- [ ] Mock fallback running in a second browser tab: `npm run demo` → http://localhost:5173.
- [ ] Recorded video of each beat on the desktop.
- [ ] Notifications off, browser zoom 110–125 %, Copilot pane width so the widget shows the whole table.

## Beat 1: Grounded start (2 min)

**Say:** "AI used to live next to the app. Watch what happens when I simply open a customer."

| Click / type | What the audience sees | Under the hood |
|---|---|---|
| Sitemap **Customers** → view *Customers with balance* → **Fabrikam, Inc.** | Form *Collections customer* loads. At the top, the CollectionsBridge control: badge **Copilot has context**. The Copilot pane opens by itself on **Collections** | PCF `updateView` → `isM365CopilotEnabled()` → `updateContext({ entity, customerNo: "DEMO-C-1001", view: "Overdue invoices", filterXML, overdueTotal… })` → `openM365CopilotPanel()` (`autoOpenPanel` = true) |
| Type in Copilot: **"Who am I looking at, and how bad is it?"** | The agent answers about Fabrikam without being told the name | Context from the app. The agent calls `get_customer_context` for the numbers |

**Point at:** the sub-grid *Overdue invoices* below is the same view whose `filterXML` went into the context.

**If it fails:** if the pane doesn't open, click the Copilot button in the app header. If it opens on
the generic Copilot, pick **Collections** in the agent list. If the agent asks "which customer?",
`updateContext` didn't reach it (risk #1). Say so ("this is exactly the sharp edge on the next slide")
and go to Beat 2: the button embeds the context in the prompt.

## Beat 2: The agent operates the app (4 min)

**Say:** "Now the app asks the agent, and the agent drives the app."

| Click / type | What the audience sees | Under the hood |
|---|---|---|
| Control → **Analyze payment behavior** | The prompt *"Use the Collections tools to analyze the payment behavior of Fabrikam, Inc. (DEMO-C-1001) and prioritize what to chase today."* appears in the pane, sent by the app. The agent: 39.7 days late, worsening 3.8 days/month, risk 85 | `sendPromptToM365Copilot(prompt, { gptId })` with the customer named in the prompt (authored agents don't receive `updateContext`), gptId from the app's default-agent variable → `get_customer_context`, `analyze_payment_behavior`, `prioritize_collections` (2–6 s, live virtual tables) |
| (no click) | The **priority-list widget** renders in the pane, 103304 at the top (*Call today*); the control switches to **Chase today** in rank order, with the same next steps as the widget | `prioritize_collections` → widget `postMessage({ eventName: 'powerapps.copilot.chat.action', action: 'Contoso.Collections.ShowWorklist' … })` → `addActionHandler` handler → ranked list in the control |
| Widget → **Open 3 critical invoices** | Side panes open for 103304, 103306, 103307 on the *Collections invoice* form | `OpenInvoices` action → `Xrm.App.sidePanes.createPane` per invoice (opened on click, not automatically: they cover the page) |
| Click the **103304** side pane | The €48,499.99 invoice, a normal BC sales invoice form over the virtual table | Side pane = record form, live from Business Central |

**Point at:** every number came from a tool call (the instructions forbid estimates). Every payload passed
the contract's allow-list before anything opened (show `bridge/handlers.ts`).

**If it fails:** if the agent answers from Work IQ (no widget, vague numbers), start a new chat and click the button again.
If the control doesn't switch to **Chase today**, click **Show chase-today list** in the widget. If that fails too,
switch to the mock tab and repeat the beat there ("same code, with the platform faked").

## Beat 3: Generative UI on two surfaces (5 min)

**Say:** "Last one: the agent builds UI, and that UI lives in both places."

| Click / type | What the audience sees | Under the hood |
|---|---|---|
| Type: **"Build me a dashboard of overdue by customer and aging bucket"** (or the *Aging dashboard* starter) | Dashboard (stacked bars + matrix) over the `DEMO-C-*` book renders **in the pane** and, a moment later, **inside the app** | `build_aging_dashboard` stores a `DashboardSpec` in `ppn_collectiondashboard` → widget → `RenderDashboard` → PCF renders the same `<AgingDashboard>` |
| In the **app**, click the **Current** chip to drop it | The app dashboard re-renders; the header shows **v2 (app)** | Spec v2 saved; `updateContext({ dashboardId, dashboardVersion: 2, dashboardFilters })` |
| Type: **"What does the dashboard show now?"** | Agent: "You changed it in the app: v2, buckets 1–30, 31–60, 61–90, 90+…" | Agent calls `get_dashboard` with the id from the context (or from the prompt) |
| Optional: in the **widget**, toggle **1–30** | The widget updates, the app follows (v3) | `app.callServerTool('update_dashboard')` → re-post `RenderDashboard` → `app.updateModelContext(...)` |

**Say (sharp edge):** "The widget can't be pushed to. Copilot has no host-context-changed event, so sync
is pull or event driven, with last-write-wins on a version number."

**If it fails:** if the dashboard doesn't appear in the app, click **Show in app** in the widget. If the
agent doesn't see the app change, say "Read dashboard \<id\>" (the id is in the context JSON), or use the mock.

## Bonus (if time): propose, then confirm (1 min)

Type: **"Log a follow-up: Fabrikam promised to pay 103304 by 2026-12-04"** → the agent calls
`propose_follow_up` (writes nothing) → card in the pane → **Log in app** → the app shows the confirm
dialog *Log follow-up proposed by Copilot?* → **Log follow-up** → a `ppn_collectionaction` row.
"The agent never writes to the ERP, and nothing is written without a human click, in the app."

Fallback if the widget route fails: the same action via Adaptive Card `Action.Submit` with
`{ type: "PowerApps", action: "Contoso.Collections.LogFollowUp", actionData }`
(`createAdaptiveCardSubmitData` in the contract).

## Full fallback: the mock (no tenant, no network)

```bash
npm install
```

```bash
npm run demo
```

- `npm run demo` builds the widgets and starts http://localhost:5173.
- Left: a fake model-driven app running the **real** PCF bridge and components. Right: a fake Copilot
  pane running the **real** MCP server and tools in the page, and the **real** widget HTML in iframes.
  It uses the fixture data (Fabrikam C-1001, SI-104008), not the tenant.
- The four chips under the pane are the beats' prompts. **Analyze payment behavior** in the control is
  Beat 2 exactly as on stage.
- *Bridge events* at the bottom lists each `updateContext`, prompt, action, side pane and audit row, which helps when narrating.
- The **M365 Copilot enabled** switch shows graceful degradation.
- `?mcp=http` uses a separately running server instead (`npm run demo:http`).
- Rehearsal check: `npm run smoke -w mock` (Playwright) drives all beats and saves screenshots.

## After the session

- Set `DEMO_AS_OF=` (empty, keep the line so `azure.sh` overwrites the old value) in `deploy/tenant.env`, then rerun `bash deploy/azure.sh` and `node deploy/bind-pcf.mjs`
  so both the server and the control use the real date again.
