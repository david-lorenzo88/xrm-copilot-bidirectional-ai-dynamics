# Demo script: three beats (about 12 minutes)

Hero customer: **Fabrikam, Inc. (C-1001)**. With the fixture data and "today" = 27 Nov 2026, the numbers
are €73,588.53 overdue across 4 invoices, and **SI-104008, €48,500, 100 days overdue**. Average 39.7 days
late and getting worse (+3.8 days/month). Risk 85/100. The real tenant shows whatever your seeded BC
data says; the beats don't depend on exact numbers.

Screenshots of every beat from the mock: `docs/img/`.

## Before you go on stage

- [ ] Signed in as the demo user; Collections Workspace open; Copilot panel closed.
- [ ] `isM365CopilotEnabled` cache is warm (open a customer once in the last 30 minutes).
- [ ] MCP server warm: `curl https://<app>/healthz` → `"status":"ok"`, `dataMode: "dataverse"`.
- [ ] Previous demo's side panes closed; no Fabrikam dashboard open (or delete the row in *Dashboards*).
- [ ] Mock fallback running in a second browser tab: `npm run demo` → http://localhost:5173.
- [ ] Recorded video of each beat on the desktop.

## Beat 1: Grounded start (2 min)

**Say:** "AI used to live next to the app. Watch what happens when I simply open a customer."

| Click / type | What the audience sees | Under the hood |
|---|---|---|
| Sitemap **Customers** → **Fabrikam, Inc.** | Form loads; control badge turns **Copilot has context**; Copilot panel opens on its own | PCF `updateView` → `isM365CopilotEnabled()` → `updateContext({ entity, customerNo, view, filterXML, overdueTotal… })` → `openM365CopilotPanel()` |
| Type in Copilot: **"Who am I looking at, and how bad is it?"** | Agent answers about Fabrikam without being told the name | Context from the app; agent calls `get_customer_context` for numbers |

**Point at:** the filterXML in the context is exactly the *Overdue invoices* view filter.

**If it fails:** if the panel doesn't open, click the Copilot button. If the agent asks "which customer?",
updateContext didn't reach it (risk #1). Say so, then go straight to Beat 2: the button embeds the
context in the prompt.

## Beat 2: The agent operates the app (4 min)

**Say:** "Now the app asks the agent, and the agent drives the app."

| Click / type | What the audience sees | Under the hood |
|---|---|---|
| Control → **Analyze payment behavior** | Prompt appears in the panel "sent by the app"; agent answers: pays ~40 days late, getting worse, risk 85 | `sendPromptToM365Copilot(prompt + [App context], { gptId })` → `analyze_payment_behavior` |
| (no click) | **Priority-list widget** renders in the panel; **3 side panes** open (SI-104008, SI-104010, SI-104011); the list switches to **Chase today** in rank order | `prioritize_collections` → widget `postMessage({ eventName: 'powerapps.copilot.chat.action', action: 'Contoso.Collections.OpenInvoices' … })` and `ShowWorklist` → `addActionHandler` handlers → `Xrm.App.sidePanes.createPane` + ranked list |
| Click the **SI-104008** pane | The €48,500 invoice, 100 days overdue | The side pane is a normal record form |

**Point at:** every number came from a tool call (instructions forbid estimates). Every payload passed the
contract's allow-list before anything opened (show `bridge/handlers.ts`).

**If it fails:** if no side panes open, the widget action didn't reach the app (Phase 0 check c). Click
**Open 3 critical invoices** in the widget. If that also fails, switch to the mock tab and repeat the beat
there ("this is the same code, with the platform faked").

## Beat 3: Generative UI on two surfaces (5 min)

**Say:** "Last one: the agent builds UI, and that UI lives in both places."

| Click / type | What the audience sees | Under the hood |
|---|---|---|
| Type: **"Build me a dashboard of overdue by customer and aging bucket"** | Dashboard (stacked bars + matrix) renders **in the panel** and, a moment later, **inside the app** | `build_aging_dashboard` stores a `DashboardSpec` → widget → `RenderDashboard` → PCF stores it (LWW) and renders the same `<AgingDashboard>` |
| In the **app**, click the **Current** chip to drop it | App dashboard re-renders; header shows **v2 (app)** | Spec v2 saved to `ppn_collectiondashboard`; `updateContext({ dashboardId, dashboardVersion: 2, dashboardFilters })` |
| Type: **"What does the dashboard show now?"** | Agent: "You changed it in the app: v2, showing buckets 1–30, 31–60, 61–90, 90+…" | Agent calls `get_dashboard(dashboardId from context)` |
| Optional: in the **widget**, toggle **1–30** | Widget updates, app follows (v3) | `app.callServerTool('update_dashboard')` → re-post `RenderDashboard` → `app.updateModelContext(...)` |

**Say (sharp edge):** "The widget can't be pushed to. There is no host-context-changed event in
Copilot, so sync is pull or event driven, with last-write-wins on a version number."

**If it fails:** if the dashboard doesn't appear in the app, click **Show in app** in the widget. If
the agent doesn't see the change, ask "Read dashboard <id>" (it's in the context JSON), or show the
mock.

## Bonus (if time): propose, then confirm (1 min)

Type: **"Log a follow-up: Fabrikam promised to pay SI-104008 by 2026-12-04"** → the agent calls
`propose_follow_up` (writes nothing) → card in the panel → **Log in app** → the app shows a **confirm
dialog** → **Log follow-up** → a `ppn_collectionaction` row. "The agent never writes to the ERP,
and nothing is written without a human click, in the app."

Fallback if the widget route fails: the same action via Adaptive Card `Action.Submit` with
`{ type: "PowerApps", action: "Contoso.Collections.LogFollowUp", actionData }`
(`createAdaptiveCardSubmitData` in the contract).

## Full fallback: the mock (no tenant, no network)

```bash
npm install
npm run demo        # builds the widgets, starts http://localhost:5173
```

- Left: a fake model-driven app running the **real** PCF bridge and components. Right: a fake Copilot
  panel running the **real** MCP server and tools in the page, and the **real** widget HTML in iframes.
- The four chips under the panel are the beats' prompts. **Analyze payment behavior** in the control is
  Beat 2 exactly as on stage.
- *Bridge events* at the bottom lists each `updateContext`, prompt, action, side pane and audit row, which helps when narrating.
- The **M365 Copilot enabled** switch shows graceful degradation.
- `?mcp=http` uses a separately running server instead (`npm run demo:http`).
- Rehearsal check: `npm run smoke -w mock` (Playwright) drives all beats and saves screenshots.
