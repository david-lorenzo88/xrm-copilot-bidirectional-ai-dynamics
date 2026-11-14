# Plan: "Building the Bridge" — Xrm.Copilot bidirectional demo app + session deck

## 0. Goal

Two deliverables for one session:

1. **A working demo app.** It is a Collections Workspace, a model-driven app over Business Central virtual tables. It is bridged to Microsoft 365 Copilot through `Xrm.Copilot`, a declarative agent and an MCP Apps server.
2. **A PowerPoint deck.** It uses the provided template and tells the same story: problem, three demo beats, architecture deep dive, and a GA/preview/licensing/production map.

The demo must run live, and it also needs a fallback. A recorded video plus a mock mode covers a failed tenant.

---

## 1. What the platform gives us (verified against Learn, Nov 2026)

| Capability | API / mechanism | Status (per docs) | Used in demo beat |
|---|---|---|---|
| Check availability | `Xrm.Copilot.isM365CopilotEnabled()` (checks license, env setting, Dataverse indexing, app override, rollout flag; cached 30 min) | GA | All (guard) |
| Open panel | `Xrm.Copilot.openM365CopilotPanel()` | GA | 1 |
| App → agent prompt | `Xrm.Copilot.sendPromptToM365Copilot(text, { gptId, ... })` | GA | 2 |
| App → agent context | `Xrm.Copilot.updateContext({ entity, filterXML, ... })` | GA in reference index, **"preview" on the maker page** (needs a re-check) | 1, 3 |
| Agent → app actions | `Xrm.Copilot.addActionHandler(actionId, fn)` / `removeActionHandler` | GA | 2, 3 |
| Built-in actions | `MS.PA.CopilotChat.OpenRecord`, `MS.PA.CopilotChat.NavigateToView` (+ `add/removeDefaultActionHandlers`) | GA | 2 |
| Which agent is active | `Xrm.Copilot.getCurrentAgent()` | GA | Diagnostics |
| Copilot Studio topics | `executeEvent`, `executePrompt` → `MCSResponse[]` | **Preview** | Optional "bonus" / map slide only |
| Agent emits action | Adaptive Card `Action.Submit` with `{ type: "PowerApps", action, actionData }` **or** MCP app HTML `window.parent.parent.postMessage({ eventName: 'powerapps.copilot.chat.action', action, actionData }, '*')` | Documented | 2, 3 |
| Generative UI in Copilot | MCP Apps (`_meta.ui.resourceUri`, `app.callServerTool`, `app.sendMessage`, `app.updateModelContext`, `app.ontoolresult`…) in declarative agents | Documented. GA status needs confirmation (community sources say GA June 2026) | 2, 3 |
| ERP data in Dataverse | Business Central virtual tables (`dyn365bc_*`) | GA | All |

Known gaps to design around. Each one also goes on a "sharp edges" slide:
- MCP Apps in Copilot **does not support** `onhostcontextchanged`, `onteardown`, `ontoolinputpartial` or `sendLog`. The only tool annotation it honors is `readOnlyHint`. The host therefore cannot push live updates into a widget, so sync must be pull- or event-driven.
- The maker page says *authored agents can't yet use in-app user context to tailor responses*. We have to confirm exactly how far `updateContext` reaches a declarative agent. **This is the #1 technical risk** (see §7).
- Starter prompts don't render when a default agent is set.
- Widgets render on `{sha256(mcp-domain)}.widget-renderer.usercontent.microsoft.com`. This affects CSP, CORS and auth.
- Sources conflict on static vs. dynamic tool discovery. If we pin tools, at least one of them must return a widget.

---

## 2. Architecture

```
┌───────────────────────── Model-driven app (Collections Workspace) ─────────────────────────┐
│  Customer form / Overdue invoices view                                                      │
│  ┌──────────────────────────────┐        Xrm.Copilot.updateContext(customer, view, filter)  │
│  │ PCF: CollectionsBridge       │ ───────────────────────────────────────────────┐          │
│  │  • context publisher         │        Xrm.Copilot.sendPromptToM365Copilot()   │          │
│  │  • "Analyze payment" button  │ ─────────────────────────────────────────────┐ │          │
│  │  • action handlers           │ ◄── Contoso.Collections.* actions ─────────┐ │ │          │
│  │  • <AgingDashboard/> host    │                                            │ │ │          │
│  └──────────────────────────────┘                                            │ │ │          │
│  Side panes (Xrm.App.sidePanes) ◄── OpenInvoices handler                     │ │ │          │
│                                                     ┌────────────────────────┴─┴─┴───────┐  │
│                                                     │ M365 Copilot side panel            │  │
│                                                     │  Declarative agent "Collections"   │  │
│                                                     │   └ MCP action plugin ─────────────┼──┼──► MCP Apps server
│                                                     │   └ widgets (ui://…) ─ postMessage │  │      (Node/TS, Azure)
│                                                     └────────────────────────────────────┘  │       • tools
└─────────────────────────────────────────────────────────────────────────────────────────────┘       • ui:// widgets
         ▲                                                                                              │
         │ Dataverse Web API (virtual tables)                                       Dataverse Web API (OBO)│
         └──────────── Dataverse ── BC virtual table provider ── Business Central (customers, invoices, CLE)┘
```

### 2.1 Components (repo layout)

```
/packages/collections-ui     Shared React + Fluent UI v9 components: AgingDashboard, PriorityList, InvoiceCard.
                             One codebase, two build targets → "same components on both surfaces".
/pcf/CollectionsBridge       PCF control (virtual/React control) placed on the Customer form + a dashboard page.
/mcp-server                  Node/TypeScript MCP server (@modelcontextprotocol/sdk + ext-apps).
  /src/tools                 get_customer_context, analyze_payment_behavior, prioritize_collections,
                             build_aging_dashboard (+ readOnlyHint where applicable)
  /src/widgets               priority-list.html, aging-dashboard.html (single-file Vite builds of collections-ui)
  /src/dataverse             Dataverse client (OBO token), FetchXML builders, aging-bucket calculator
/agent                       M365 Agents Toolkit project: declarative agent manifest, instructions,
                             MCP plugin manifest, conversation starters, icons.
/dataverse/solution          Unmanaged solution: model-driven app, sitemap, forms, views, PCF registration,
                             local table `contoso_collectiondashboard` (dashboard spec JSON),
                             `contoso_collectionaction` (audit of agent-initiated actions), security role.
/bc                          (Optional) BC AL extension: custom API page for Customer Ledger Entries if the
                             standard virtual-table catalog lacks what we need; seed data script.
/mock                        Mock Xrm.Copilot shim + fixture data, for local dev and as the offline demo fallback.
/deck                        python-pptx generator driven by the template, diagrams (SVG→PNG), speaker notes.
/docs                        Setup guide, demo script, production-readiness checklist.
```

### 2.2 The bridge contract (the core idea)

A versioned action/context contract in `packages/collections-ui/contract.ts`. PCF, MCP server and widgets all import it.

**App → agent (context)** via `updateContext`:
```ts
{ entity: "dyn365bc_customer_v2_0", recordId, customerNo, customerName,
  view: "Overdue invoices", filterXML: "<fetch>…</fetch>",
  overdueTotal, currency, dashboardId? }
```

**Agent → app (actions)** via `addActionHandler`:
| Action ID | Payload | App behavior |
|---|---|---|
| `MS.PA.CopilotChat.OpenRecord` (built-in) | `entity, recordId` | Default: open record |
| `Contoso.Collections.OpenInvoices` | `invoiceIds[]` | Open each critical invoice in its own side pane (`Xrm.App.sidePanes.createPane`) |
| `Contoso.Collections.ShowWorklist` | `fetchXml, title` | Navigate to the Overdue view with the prioritized filter (wraps `NavigateToView`, with a custom title/ordering) |
| `Contoso.Collections.RenderDashboard` | `dashboardId` or inline `spec` | Persist the spec to `contoso_collectiondashboard`, then render `<AgingDashboard spec>` in-app |
| `Contoso.Collections.LogFollowUp` | `customerNo, note, promiseDate` | Propose-then-confirm: dialog → write a local Dataverse record (never writes to BC directly) |

**Shared state.** The dashboard spec is the state. It is a small JSON document (`{ groupBy: ["customer","agingBucket"], measures, filters, buckets }`) stored in Dataverse.
- The agent creates or updates it with the `build_aging_dashboard` tool. The widget renders it in the Copilot pane.
- The widget emits `RenderDashboard`, and the PCF renders the same spec with the same component.
- When the user changes a filter in-app, the PCF updates the record and calls `updateContext({ dashboardId, spec })`, so the agent's next turn sees the change.
- When the user changes something in the widget, `app.callServerTool` updates the record and re-emits the action.
- Last-write-wins with a `version` field. We say on stage that live push to the widget is not possible today.

### 2.3 Data layer: BC virtual tables

- Install the Business Central Virtual Tables app in Dataverse and the matching BC extension, then enable these tables: customers, sales invoices (+ lines), customer ledger entries (or a custom API page), payment terms.
- **Aging is calculated in the MCP server, not in FetchXML.** Virtual tables have limited aggregate/group-by support. Doing it in code also makes for a better architecture talking point.
- Seed a BC sandbox with about 25 customers and about 300 invoices, with deliberate patterns: chronic late payers, one large invoice at 90+ days, and a customer that is improving. This gives the agent's analysis something real to find.
- Read-only toward the ERP. Agent-proposed actions write only to local Dataverse tables, which is a governance talking point.

---

## 3. Demo script → implementation mapping

| Beat | What the audience sees | What happens underneath |
|---|---|---|
| **1. Grounded start** | Open customer "Fabrikam" (overdue). Copilot panel opens already aware of customer/view/filter. | PCF `init/updateView` → `isM365CopilotEnabled` → `updateContext(...)` → `openM365CopilotPanel()`. Default agent = Collections agent. |
| **2. Agent operates the app** | Click **Analyze payment behavior**. Copilot answers, side panes open with critical invoices, grid switches to a prioritized "chase today" list. | `sendPromptToM365Copilot(prompt, { gptId })` → agent calls `analyze_payment_behavior` + `prioritize_collections` → widget `priority-list` renders and auto-posts `OpenInvoices` + `ShowWorklist` (plus card buttons for explicit user confirmation). |
| **3. Generative UI, two surfaces** | "Build me a dashboard of overdue by customer and aging bucket." It renders in the Copilot pane **and** materializes inside the app. Change a filter in-app and the agent knows. | `build_aging_dashboard` → `aging-dashboard` widget → `RenderDashboard` action → PCF renders the same `<AgingDashboard>` from the stored spec → `updateContext` on change. |

Demo-safety: the PCF has a `?mock=1` mode that uses `/mock` (a fake `Xrm.Copilot` and fake Copilot pane). A pre-recorded video covers each beat.

---

## 4. Work phases

| # | Phase | Output | Exit criterion |
|---|---|---|---|
| 0 | **Spike & verify** (de-risk first) | Throwaway PCF + minimal declarative agent + 1-tool MCP server | Proven in a real tenant: (a) `updateContext` content reaches our declarative agent, (b) a custom action from MCP widget HTML reaches `addActionHandler`, (c) side panes open from a handler |
| 1 | Environment | Tenant with M365 Copilot licenses, Dataverse env, BC sandbox, virtual tables configured, seed data | Overdue view shows live BC data |
| 2 | Contract + shared UI package | `contract.ts`, `AgingDashboard`, `PriorityList`, Storybook-style local preview | Components render from fixture specs |
| 3 | MCP server | Tools, Dataverse OBO client, aging calc, two widgets, Entra auth, Azure Container Apps deploy | MCP Inspector passes; widgets render in Copilot |
| 4 | Declarative agent | Manifest, instructions (collections-specialist persona, action discipline), plugin, starters | Agent answers grounded and emits actions |
| 5 | PCF + app | CollectionsBridge, handlers, side panes, dashboard page, solution packaging | Beats 1–3 work end to end |
| 6 | Hardening | Mock mode, error/“Copilot disabled” states, telemetry (App Insights), audit table, ALM pipeline (pac CLI) | Full rehearsal ×3 without intervention |
| 7 | Deck | python-pptx build from the template, diagrams, speaker notes, GA/preview map, checklist | Deck reviewed; screenshots from the real app |
| 8 | Docs | README, setup guide, demo runbook, production-readiness checklist | Someone else can stand it up from the docs |

Deck work (7) can start in parallel after Phase 0, using placeholders for screenshots.

### 4.1 Compressed calendar (session is Fri 27 Nov 2026)

| Dates | Focus |
|---|---|
| Nov 14–15 | Deck v1 from template (no screenshots). Repo scaffolding, contract, shared UI package, mock mode |
| Nov 16–17 | Phase 0 tenant spike + environment (BC sandbox, virtual tables, seed data) |
| Nov 18–20 | MCP server + widgets, declarative agent |
| Nov 21–23 | PCF + model-driven app, beats 1–3 end to end |
| Nov 24–25 | Hardening, record fallback videos, screenshots into deck v2 |
| Nov 26 | Re-verify GA/preview map, final rehearsal, freeze |

Scope cut if the spike slips: `LogFollowUp` and the Copilot Studio bonus are dropped first. Beat 3 then falls back to rendering the dashboard in-app only.

---

## 5. Deck: built on `AIERP_Summit_2026_Template.pptx`

### 5.1 Template facts
- 16:9 (13.33" × 7.5"), 19 sample slides, LEGO-brick visual language. The palette is red `D01012` / dark red `750909` / yellow `FFD100` / ice blue `C9F2F8`, on white or brick-texture backgrounds.
- Fonts: **Segoe UI** for body and **Roboto Bold** for headings. Neither is installed in this container, so render QA here is approximate. Leave about 10% text slack and do a final check in real PowerPoint.
- Event: D365 Community Summit / AI ERP Summit, **27 November 2026, Lisbon**. That is **13 days from today**, so the schedule in §4 has to be compressed (see §4.1).
- No code or diagram layout exists. Code and architecture slides go on the plain white "Title" slide (`slide7`) with our own dark code panel and diagram images, styled in the template palette.
- About 20 MB of media. Unused sample slides are removed with `clean.py` so the output stays lean.

### 5.2 Build approach
Use template editing, not a from-scratch generator: unzip → duplicate the chosen sample slides → replace text in the slide XML → clean → zip → validate (`--original` template) → render to images for QA. The content lives in `deck/content.yaml` (titles, body text, speaker notes), and a script in `deck/` builds the slides from it. Re-running the build after every content change keeps the deck reproducible. Screenshots of the real app replace placeholders as Phase 5 lands.

### 5.3 Slide-by-slide mapping (about 24 slides, roughly 45 min with live demo; adjust to slot)

| # | Slide | Template slide | Notes |
|---|---|---|---|
| 0 | Walk-in / holding | `slide4` (Summit splash) | Unchanged |
| 1 | Title + speaker | `slide2` (speaker card) | Session title, name, photo, track "Business Central / Power Platform" |
| 2 | The side-panel era | `slide14` (statement card) | "AI lived next to the app, not in it" |
| 3 | The wall comes down | `slide15` (red text + 3 round icons) | Share context · Ask · Act |
| 4 | Agenda | `slide19` (title + 3 icon columns) | Demo · Architecture · Production |
| 5 | Scenario | `slide6` "Business Central" (3 cards) | Customers · Invoices · Ledger entries, all live via virtual tables |
| 6 | **Section: Live demo** | `slide8` (title on brick wall) | |
| 7 | Three demo beats | `slide10` (red panel + 3 rows) | Grounded start · Agent operates the app · Generative UI |
| 8–10 | Demo beat 1 / 2 / 3 recap | `slide7` (white Title) + screenshot | Doubles as fallback if the live demo fails |
| 11 | **Section: Architecture** | `slide9` (Title + Section 1/Section 2) | "One experience, two surfaces: App │ Copilot" |
| 12 | Architecture at a glance | `slide7` + diagram | Diagram from §2, redrawn in template palette |
| 13 | The three building blocks | `slide5` (3 cards) | PCF · Declarative agent · MCP Apps server |
| 14 | The `Xrm.Copilot` map | `slide13` (5 icon rows) | Availability · Panel & prompt · Context · Actions · Copilot Studio (preview) |
| 15 | App → agent (code) | `slide7` + code panel | `updateContext` + `sendPromptToM365Copilot` |
| 16 | Agent → app (code) | `slide7` + code panel | `addActionHandler`, built-in vs custom, widget `postMessage` |
| 17 | The bridge contract | `slide16` (4 yellow columns) | OpenInvoices · ShowWorklist · RenderDashboard · LogFollowUp |
| 18 | Shared state loop | `slide17` (circular hub, 6 nodes) | Spec → widget → action → PCF → updateContext → agent |
| 19 | Agents on ERP data | `slide11` (3 cards + image) | Virtual tables, compute in the MCP server, read-only to ERP |
| 20 | **Section: Production** | `slide8` | |
| 21 | GA vs Preview vs Check-before-you-ship | `slide18` (3 yellow columns) | Dated "verified on" stamp |
| 22 | Licensing & prerequisites | `slide12` (title + 3 icon columns) | Users · Environment · Data |
| 23 | Production-readiness checklist | `slide13` (5 icon rows) | Licensing · Governance · Security · ALM · Gotchas |
| 24 | Key takeaways | `slide15` | The five takeaways from the abstract |
| 25 | Thank you + sponsors | `slide3` | Add repo link / QR |

Not used: `slide1` (the template's own cover). Every slide gets speaker notes, and code slides use real snippets from the repo.

---

## 6. Production-readiness checklist (seed, to be verified)

- **Licensing:** a Microsoft 365 Copilot license per user, Dynamics 365 / Power Apps licenses, and a Business Central license. Check whether virtual-table use needs additional entitlement.
- **Environment:** Copilot enabled at tenant + environment + app level, Dataverse search/indexing on, and the default agent configured in the app's Copilot settings.
- **Governance:** agent publish/approval in the M365 admin center, DLP for the MCP connector, data residency (`geo` in context), and an audit of agent-initiated actions.
- **Security:** Entra SSO/OBO for the MCP server, least-privilege Dataverse role, read-only to ERP, a confirm step for any write, an allow-list of action IDs in the PCF, and `postMessage` payload validation.
- **Gotchas:** preview APIs (`executeEvent`/`executePrompt`, possibly `updateContext`), the `isM365CopilotEnabled` 30-minute cache, the widget sandbox domain/CSP, unsupported MCP Apps host events, virtual table query limits/latency, starter prompts hidden with a default agent, and ALM for an agent + PCF + Azure service as one release.

---

## 7. Risks & open questions

| Risk | Mitigation |
|---|---|
| `updateContext` may not reach a *declarative* agent ("authored agents can't yet use in-app user context") | Phase 0 spike. Fallback: the PCF embeds the context in the prompt sent with `sendPromptToM365Copilot`, and/or the agent calls `get_customer_context` |
| Custom actions from MCP widgets may only work for specific hosts/agent modes | Phase 0 spike. Fallback: Adaptive Card `Action.Submit` with `type: "PowerApps"` |
| Tenant/licensing availability for the live demo | Mock mode + recorded video |
| BC virtual table catalog lacks the ledger detail | Custom AL API page in `/bc` |
| Docs change between now and the session | Re-verify the GA/preview map one week before and date-stamp the slide |
