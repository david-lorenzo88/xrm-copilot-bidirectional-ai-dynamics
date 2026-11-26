# Demo script: three beats (about 12 minutes)

Live tenant: app **Collections Workspace** on `premium-us`, Business Central **CRONUS ES** (environment
*Production*) through virtual tables, agent **Collections** set as the app's default agent.

Hero customer: **Fabrikam, Inc. (DEMO-C-1001)**. With the demo date `DEMO_AS_OF=2026-11-27` (the session
day) the live tenant shows:

| What | Value |
|---|---|
| Open balance | **€73,588.52** across 4 open invoices |
| Worst invoice | **103304, €48,499.99, 100 days overdue (90+)**, ranked #1, *Call today* |
| Payment behaviour | **39.7 days late** on average (55.4 amount-weighted), **worsening** +3.8 days/month, 0 % on time, risk **85**/100, credit use 123 % |
| Whole demo book (25 `DEMO-C-*` customers) | 300 invoices posted, 269 paid and closed, 31 open (€221,327.21) |
| Aging dashboard (overdue on 27 Nov) | **€124,753.11** over six customers, Fabrikam first (€73,588.52); without 90+ **€76,253.12** |

Other open Fabrikam invoices: 103306 (€8,604.52), 103307 (€9,628.45) and 103308 (posted 22 Nov).
The beats don't depend on exact numbers, but these are what you should see on stage.

The *Overdue invoices* view and its sub-grid use the **real** date (a view filter can't take a demo date).
Only the agent's numbers and the PCF use `DEMO_AS_OF`. Before 27 Nov the sub-grid shows fewer overdue rows
than the agent reports; on the day they match.

Every beat below was run end to end in the tenant on 15 Nov 2026. Screenshots in `docs/img/` still come from the mock
host (fixture numbers such as SI-104008).

## Before you go on stage

- [ ] Signed in as the demo user (M365 Copilot licence). Collections Workspace open on the sitemap, Copilot pane closed.
- [ ] Tenant switches still on (setup.md §7), above all Microsoft 365 admin center → Copilot → Settings →
      *Business Applications data in Work IQ available to Copilot* = All users. If the header has no **Copilot** button,
      run `await Xrm.Copilot.isM365CopilotEnabled()` in the console: `false` means a switch is off.
- [ ] Open Fabrikam once in the last 30 minutes, so the `isM365CopilotEnabled()` cache is warm, and close it again.
- [ ] MCP server healthy (it runs with min replicas 1, so no cold start):
  ```bash
  curl -s "$(grep ^PUBLIC_BASE_URL deploy/outputs.env | cut -d= -f2)/healthz"
  ```
  Expect `"status":"ok"`, `"dataMode":"dataverse"`, `"authMode":"entra"`.
- [ ] One rehearsal run of all three beats on the day, so SSO, the action consent (*Allow*) and the dashboard
      *Confirm* (pick **Always allow** if offered) are already granted.
- [ ] Old dashboards deleted in *Collection dashboards* (the agent's "the dashboard" means the latest one), so Beat 3 starts at v1.
- [ ] Side panes from the rehearsal closed.
- [ ] A Microsoft 365 Copilot tab (m365.cloud.microsoft/chat) open on the **Collections** agent, new chat, for Beat 1.
- [ ] The pane is open on **Collections**. Don't use **+** (new chat) on stage: a new chat starts on plain Copilot, without
      the default agent. For a clean chat, close the pane (**X**) and reopen it with **Copilot** in the header.
- [ ] Mock fallback running in a second browser tab: `npm run demo` → http://localhost:5173.
- [ ] Recorded video of each beat on the desktop.
- [ ] Notifications off, browser zoom 110–125 %, Copilot pane width so the widget shows the whole table.

## Beat 1: Outside the app, then inside (3 min)

**Say:** "AI used to live next to the app. Same agent, two places: first next to the app, then inside it."

| Click / type | What the audience sees | Under the hood |
|---|---|---|
| Microsoft 365 Copilot (m365.cloud.microsoft/chat) → agent **Collections** → type *"Analyze this customer's payment behavior and tell me what to chase today."* | The agent asks which customer | Outside the app there is no open record and no app: the agent can't know |
| Switch to the app: Sitemap **Customers** → view *Customers with balance* → **Fabrikam, Inc.** | Form *Collections customer* loads; the control shows **Copilot has context**, *Overdue €73,588.52*; the pane opens by itself on **Collections** | `isM365CopilotEnabled()` → `updateContext({...})` → `openM365CopilotPanel()` on the app's default agent |
| Control → **Analyze payment behavior** | The prompt names **Fabrikam, Inc. (DEMO-C-1001)**; Beat 2 starts from here | `sendPromptToM365Copilot(prompt, { gptId })`: one click, the right agent, the right customer |

**Say (what the platform gives, what the bridge adds):** "Inside the app, the pane already knows which record is
open. What it doesn't pass to our agent is what the app knows on top: the customer number, the view and its filter,
the totals. So the bridge puts that in the prompt, and then it lets the agent act on the app, which is the next beat."

**If it fails:** if the agent outside the app guesses a customer, say "it's guessing, which is exactly the problem",
and go to the app. If the pane doesn't open, click **Copilot** in the header; if it opens on plain Copilot, close and
reopen it.

## Beat 2: The agent operates the app (3 min)

**Say:** "Now the app asks the agent, and the agent drives the app."

| Click / type | What the audience sees | Under the hood |
|---|---|---|
| (from Beat 1) **Analyze payment behavior** with the switch on | The prompt *"Use the Collections tools to analyze the payment behavior of Fabrikam, Inc. (DEMO-C-1001) and prioritize what to chase today."* appears in the pane, sent by the app. The agent: 39.7 days late, worsening 3.8 days/month, risk 85 | `sendPromptToM365Copilot(prompt, { gptId })` with the customer named in the prompt (authored agents don't receive `updateContext`), gptId from the app's default-agent variable → `get_customer_context`, `analyze_payment_behavior`, `prioritize_collections` (2–6 s, live virtual tables) |
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
| Control → **Build aging dashboard** (or type *"Build me a dashboard of overdue by customer and aging bucket"*) | Copilot shows a **Confirm** card for the tool. Click **Confirm** | `build_aging_dashboard` writes the spec to Dataverse, so it isn't `readOnlyHint` and Copilot asks first. Say: "the platform asks before any tool that writes, and the ERP is never written" |
| (no click) | Dashboard (stacked bars + matrix) renders **in the pane** and, a moment later, **inside the app**: both **€124,753.11**, six customers, Fabrikam first | Spec v1 in `ppn_collectiondashboard` → widget → `RenderDashboard` → the control renders the same `<AgingDashboard>`, scoped to `DEMO-C-*` like the server |
| In the **app**, click the **90+** chip | App dashboard re-renders: Fabrikam drops to €25,088.53, total **€76,253.12**, header **v2 (app)**, and an **Ask Copilot** button appears. The widget still shows v1 | Spec v2 saved by the app (last write wins on the version) |
| App → **Ask Copilot** (or type *"What does the dashboard show now?"*) | The agent reports the app's change, and the widget **re-renders at v2 (app)**: both surfaces match again | `get_dashboard()` without an id returns the latest dashboard; its widget replaces the stale one |
| Optional: in the **widget**, toggle **61–90** | Widget and app both move to v3 | `update_dashboard` → `RenderDashboard` to the app |

**Say (sharp edge):** "The widget can't be pushed to. Copilot has no host-context-changed event, and the app's context
doesn't reach our agent, so sync is pull: the agent re-reads the stored version, with last-write-wins on a version number."

Don't use the **Current** chip: the dashboard measures overdue amounts, so that column is always empty and removing
it changes nothing visible.

**If it fails:** if the dashboard doesn't appear in the app, click **Show in app** in the widget. If the agent
answers about the old version, click **Ask Copilot** in the app (the prompt names the tools).

## Bonus (if time): research online, then insert into the record (2 min)

Optional: rehearse it first; skip it if web search misbehaves.

| Click / type | What the audience sees | Under the hood |
|---|---|---|
| Control → **Research online** | The prompt asks for the payment and credit climate around Fabrikam, Inc. (DEMO-C-1001), based in Lisbon: late-payment trends, insolvencies, regulation, "don't search for the company itself" | `sendPromptToM365Copilot` with `gptId`; the agent has the WebSearch capability |
| (no click) | The agent searches the web and shows a card: **Insert this research into the record?** with a short summary and source links | `propose_research_note` (writes nothing) |
| Card → **Insert into record** → **Insert research** in the app's dialog | The **Notes** list on the form shows the note with its sources | `LogFollowUp` action (kind research) → confirm dialog → a `ppn_collectionaction` row. Nothing goes to Business Central |

**Say:** "The agent researches, the app writes, and only after I confirm. Web facts are context; the numbers still come
from the tools." Demo customers are fictional, so the research is about the country and sector, not the company.

## Bonus 2 (if time): propose a follow-up, then confirm (1 min)

Not yet run in the tenant: rehearse it before using it on stage.


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
