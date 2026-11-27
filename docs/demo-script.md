# Demo guide: one morning in collections

Live tenant: app **Collections Workspace** on `premium-us`, Business Central **CRONUS ES** (environment *Production*)
through virtual tables, agent **Collections** set as the app's default agent. Session day: 27 Nov 2026.

## The story

**Ana** is a collections specialist at Contoso in Lisbon. It's the last week of November and month-end close is close.
Her worst account is **Fabrikam, Inc.** One question runs through the demo: *what do I chase today, and what do I do about
Fabrikam?* Each act answers it with one more piece of the bridge between the app and Copilot.

| Act | Ana's question | What the audience learns | Time |
|---|---|---|---|
| 0 · The gap | "Copilot, what should I chase for this customer?" | AI next to the app doesn't know where you are | 1 min |
| 1 · Context | She opens Fabrikam | The app and the pane know the record; one click hands over what the app knows | 2 min |
| 2 · Action | "What do I chase today?" | The agent works on live ERP data and operates the app: ranked list, side panes | 3 min |
| 3 · Shared UI | "How does the whole book look?" | One dashboard on two surfaces; a change in either place reaches the other | 4 min |
| 4 · Research *(optional)* | "Before I call: what's the climate?" | The agent researches the web; the note lands on the record after she confirms | 2 min |
| 5 · Decision *(optional)* | "Cut the credit limit and block shipments" | Copilot fills the form, Ana saves, Business Central changes | 2 min |
| 6 · New customer *(optional)* | "Set up the customer from Rita's email" | Copilot finds the email, pre-fills a new customer form, Ana saves it into Business Central | 2 min |
| Close | | Share, ask, act. The agent never writes to the ERP itself | 1 min |

Core demo: acts 0–3, about 10 minutes. With acts 4 and 5: about 15.

## Numbers you should see

With the demo date `DEMO_AS_OF=2026-11-27`, the session day:

| What | Value |
|---|---|
| Fabrikam open balance | **€73,588.52** across 4 open invoices: 103304, 103306, 103307, 103308 |
| Worst invoice | **103304, €48,499.99, 100 days overdue (90+)**, ranked #1, *Call today* |
| Payment behaviour | **39.7 days late** on average (55.4 amount-weighted), **worsening** +3.8 days/month, 0 % on time, risk **85**/100, credit use 123 % |
| Fabrikam credit limit | **€60,000**, not blocked (restore with `node deploy/demo-reset.mjs`) |
| Demo book (25 `DEMO-C-*` customers) | 300 invoices posted, 269 paid and closed, 31 open (€221,327.21) |
| Aging dashboard (overdue on 27 Nov) | **€124,753.11** over six customers, Fabrikam first; without 90+ **€76,253.12** |

The *Overdue invoices* sub-grid uses the real date. On 27 Nov the real date and the demo date are the same, so it matches
the agent.

Verified in the tenant: acts 1–3 on 15 Nov; acts 4 and 5 on 26 Nov. **Not yet run with the current agent (1.0.9): act 0
and act 6. Run both in the rehearsal.**

## Before you go on stage

- [ ] Signed in as the demo user (M365 Copilot licence).
- [ ] Tenant switches still on (setup.md §7), above all Microsoft 365 admin center → Copilot → Settings →
      *Business Applications data in Work IQ available to Copilot* = All users. If the app header has no **Copilot**
      button, run `await Xrm.Copilot.isM365CopilotEnabled()` in the console: `false` means a switch is off.
- [ ] MCP server healthy (min replicas 1, no cold start):
  ```bash
  curl -s "$(grep ^PUBLIC_BASE_URL deploy/outputs.env | cut -d= -f2)/healthz"
  ```
  Expect `"status":"ok"`, `"dataMode":"dataverse"`, `"authMode":"entra"`.
- [ ] One full rehearsal on the day (acts 0–5), so sign-in, the action consent (*Allow*) and the dashboard *Confirm*
      (pick **Always allow** if offered) are already granted.
- [ ] After the last rehearsal, reset: Fabrikam back to €60,000 and not blocked, dashboards and notes deleted:
  ```bash
  node deploy/demo-reset.mjs --all
  ```
- [ ] Browser tab 1: Microsoft 365 Copilot (m365.cloud.microsoft/chat), agent **Collections**, new chat (act 0).
- [ ] Browser tab 2: Collections Workspace on the *Customers with balance* view, Copilot pane closed, no side panes.
- [ ] Browser tab 3: the mock (`npm run demo` → http://localhost:5173), the full fallback.
- [ ] Optional tab 4: Business Central, CRONUS ES, customer Fabrikam (DEMO-C-1001), to show act 5's result.
- [ ] Backup recording of the live run on the desktop.
- [ ] Notifications off, browser zoom 110–125 %, Copilot pane wide enough for the widget's table.

**In the app pane, don't use + (new chat):** it starts plain Copilot, without the default agent. For a clean chat, close
the pane (**X**) and reopen it with **Copilot** in the header. The app's buttons always reach the agent anyway.

## Act 0 · The gap: AI next to the app (1 min)

**Say:** "This is how most of us use AI today: next to the app. Ana asks Copilot about her customer."

| Click / type | What the audience sees | Under the hood |
|---|---|---|
| Tab 1 (Microsoft 365 Copilot, agent **Collections**): *"Analyze this customer's payment behavior and tell me what to chase today."* | The agent asks which customer | Outside the app there is no open record: the agent can't know, and its instructions forbid guessing |

**Say:** "Same agent, same tools. It just doesn't know where Ana is. So let's bring it into the app."

**If it fails:** if it guesses a customer, say "it's guessing, which is exactly the problem" and move on.

## Act 1 · Context: one click hands over what the app knows (2 min)

| Click / type | What the audience sees | Under the hood |
|---|---|---|
| Tab 2: **Customers** → *Customers with balance* → **Fabrikam, Inc.** | Form *Collections customer*. The control shows **Copilot has context** and *Overdue €73,588.52*; the pane opens by itself on **Collections** | `isM365CopilotEnabled()` → `updateContext({...})` → `openM365CopilotPanel()` on the app's default agent |

**Say:** "Inside the app, the pane knows which record is open. What it doesn't pass to our agent is what the app knows on
top of that: the customer number, the view and its filter, the totals. So the app hands it over in the prompt, with one
click." Then go straight to act 2 with that click.

**If it fails:** if the pane doesn't open, click **Copilot** in the header; if it opens on plain Copilot, close and reopen it.

## Act 2 · Action: the agent operates the app (3 min)

**Say:** "Ana's real question: what do I chase today?"

| Click / type | What the audience sees | Under the hood |
|---|---|---|
| Control → **Analyze payment behavior** | The pane shows the app's prompt: *"Use the Collections tools to analyze the payment behavior of Fabrikam, Inc. (DEMO-C-1001) and prioritize what to chase today."* The agent: 39.7 days late, worsening 3.8 days/month, risk 85 | `sendPromptToM365Copilot(prompt, { gptId })` → `get_customer_context`, `analyze_payment_behavior`, `prioritize_collections` on live BC data (2–6 s) |
| (no click) | The **priority-list widget** in the pane, 103304 first (*Call today*). The control switches to **Chase today** with the same next steps | Widget → `ShowWorklist` action → the control's handler, after the contract's allow-list |
| Widget → **Open 3 critical invoices** | Side panes open for 103304, 103306, 103307 on the *Collections invoice* form | `OpenInvoices` → `Xrm.App.sidePanes.createPane`; on click, because panes cover the page |
| Click the **103304** pane | €48,499.99, due 19 Aug, live from Business Central, read-only | Record form over the virtual table |

**Say:** "Every number came from a tool, on live ERP data. And the agent didn't just answer: it changed what's on Ana's
screen, through actions the app allows and audits."

**If it fails:** if the agent answers vaguely with no widget, it answered from Work IQ: close and reopen the pane, click
**Analyze** again. If the control doesn't switch to **Chase today**, click **Show chase-today list** in the widget.

## Act 3 · Shared UI: one dashboard, two surfaces (4 min)

**Say:** "Her manager wants the big picture before the close."

| Click / type | What the audience sees | Under the hood |
|---|---|---|
| Control → **Build aging dashboard** | Copilot shows **Confirm** for the tool; click it | `build_aging_dashboard` saves a spec to Dataverse, so Copilot asks first |
| (no click) | The same dashboard **in the pane** and, a moment later, **inside the app**: **€124,753.11**, six customers, Fabrikam first | Spec v1 → widget → `RenderDashboard` → the control renders the same component |
| In the **app**, click the **90+** chip | The app's dashboard: Fabrikam €25,088.53, total **€76,253.12**, header **v2 (app)**, and an **Ask Copilot** button. The widget still shows v1 | The app saves v2 (last write wins on the version) |
| App → **Ask Copilot** | The agent reports the app's change and the widget re-renders at **v2 (app)**: both match again | `get_dashboard()` returns the latest version |

**Say (sharp edge):** "Copilot can't push into a widget, and our agent doesn't get the app's own context. So sync is
pull: the agent re-reads the stored version, last write wins."

Don't use the **Current** chip: the dashboard measures overdue amounts, so that column is always empty.

**If it fails:** if the dashboard doesn't appear in the app, click **Show in app** in the widget.

## Act 4 · Research before the call (optional, 2 min)

**Say:** "Before Ana calls Fabrikam, she wants context: how is the market treating late payers?"

| Click / type | What the audience sees | Under the hood |
|---|---|---|
| Control → **Research online** | The prompt asks for the payment and credit climate around Fabrikam, based in Lisbon: late-payment trends, insolvencies, regulation; "don't search for the company itself" | The agent has Microsoft's WebSearch capability (20–60 s) |
| (no click) | A card: **Insert this research into the record?** with a short summary and source links | `propose_research_note` writes nothing |
| Card → **Insert into record** → **Insert research** | The **Notes** list on the form shows the note and its sources | `LogFollowUp` (kind research) → confirm dialog → Dataverse; nothing goes to Business Central |

**Say:** "The agent researches, the app writes, and only after Ana confirms. Web facts are context; the numbers still come
from the tools." (Demo customers are fictional, so the research is about the country and sector.)

## Act 5 · The decision: Copilot fills the form, Ana saves to Business Central (optional, 2 min)

**Say:** "Ana decides: Fabrikam is over its limit and getting worse."

| Click / type | What the audience sees | Under the hood |
|---|---|---|
| Type in the pane: *"Fabrikam is high risk: reduce the credit limit to 40,000 and block shipments"* | A card: **Change Fabrikam, Inc. in Business Central?** €60,000 → **€40,000**, Blocked → **Ship**, with the reason | `propose_customer_update` writes nothing |
| Card → **Apply to the form** | On the form, **Credit Limit** 40,000 and **Blocked** Ship, unsaved; the control says "Review and Save to update Business Central" | `ApplyCustomerChanges` (2 fields, open customer only) → bound properties → `getOutputs` |
| Form → **Save** | Saved. Optional: tab 4, refresh Fabrikam in Business Central: 40,000, Blocked = Ship | Virtual table → Business Central API, as Ana |

**Say:** "The agent never writes to the ERP. It proposes, the app fills the form, Ana saves, with Business Central's own
validation and her own permissions."

After the session or rehearsal: `node deploy/demo-reset.mjs`.

## Act 6 · A new customer from an email (optional, 2 min)

**Not yet run in the tenant: rehearse it.** Before the session, send yourself the email below from another mailbox (or
from your own), so the agent can find it.

> **Subject:** New account – Bairro Alto Foods, Lda
>
> Hello, we'd like to open an account with Contoso. Our details:
> Bairro Alto Foods, Lda · Rua da Rosa 12, 1200-385 Lisboa, Portugal · NIF PT509123456
> Phone +351 213 456 789 · rita.sousa@bairroaltofoods.example · www.bairroaltofoods.example
> Best regards, Rita Sousa, Finance

**Say:** "One more thing lands in Ana's inbox: a new customer wants an account."

| Click / type | What the audience sees | Under the hood |
|---|---|---|
| Type in the pane: *"Set up Bairro Alto Foods as a new customer from Rita Sousa's email"* | The agent finds the email and shows a card: **Create Bairro Alto Foods, Lda in Business Central?** with No. **DEMO-C-1026**, address, city, country, phone, email, website, VAT number, and "From: Email from Rita Sousa…" | Mailbox search (the agent's Email capability) → `propose_new_customer`: only values from the email, next free number, duplicate check; writes nothing |
| Card → **Create on the form** | A **New customer** form opens as a dialog over Fabrikam, pre-filled, company CRONUS ES | `CreateCustomer` → `Xrm.Navigation.navigateTo` (dialog) with the values |
| Dialog → **Save & Close** | The control says "Created Bairro Alto Foods, Lda (DEMO-C-1026) in Business Central". Optional: tab 4, Business Central customers | Virtual table → Business Central API, as Ana |

**Say:** "From an email to an ERP customer in one click, and still nothing is written until Ana saves."

Fallback: paste the email text into the pane instead of asking the agent to find it. After the session or rehearsal:
`node deploy/demo-reset.mjs --all` deletes the rehearsal customer in Business Central.

## Close (1 min)

**Say:** "Three verbs. The app **shares** where you are, **asks** the agent with one click, and the agent **acts** on the
app through actions the app allows. Every write is a human click. That's the bridge."

## Extra (if asked): log a promise to pay

Type *"Log a follow-up: Fabrikam promised to pay 103304 by 2026-12-04"* → card → **Log in app** → confirm dialog →
**Log follow-up**: the note appears in **Notes** on the form. Not run on its own, but it uses the same path as act 4.

## Full fallback: the mock (no tenant, no network)

```bash
npm install
```

```bash
npm run demo
```

- Starts http://localhost:5173: a fake model-driven app running the **real** control code, and a fake Copilot pane
  running the **real** MCP server, tools and widgets. It uses fixture data (Fabrikam C-1001, SI-104008), not the tenant.
- Covers acts 1–3 and the promise-to-pay follow-up. It doesn't cover act 0, act 4 (web research) or act 5 (saving to
  Business Central).
- *Bridge events* at the bottom lists each context update, prompt, action, side pane and audit row.
- `npm run smoke -w mock` (Playwright) drives the beats and saves screenshots.

## After the session

- `node deploy/demo-reset.mjs --all`.
- Set `DEMO_AS_OF=` (empty, keep the line) in `deploy/tenant.env`, then rerun `bash deploy/azure.sh` and
  `node deploy/bind-pcf.mjs`, so the server and the control use the real date again.
