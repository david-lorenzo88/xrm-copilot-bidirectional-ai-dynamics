# Architecture

One experience on two surfaces. The **Collections Workspace** model-driven app and the
**Microsoft 365 Copilot** side panel share context, actions and one piece of state (a dashboard spec).

```
┌──────────────────── Model-driven app: Collections Workspace ────────────────────┐
│ Customer form (dyn365bc_customer_v2_0)                                         │
│  ┌───────────────────────────────┐  Xrm.Copilot.updateContext(context)          │
│  │ PCF CollectionsBridge         │ ─────────────────────────────────────┐       │
│  │  • context publisher          │  Xrm.Copilot.sendPromptToM365Copilot  │       │
│  │  • "Analyze payment behavior" │ ───────────────────────────────────┐ │       │
│  │  • 4 action handlers + guard  │ ◄── Contoso.Collections.* ───────┐ │ │       │
│  │  • <AgingDashboard> / list    │                                  │ │ │       │
│  └───────────────────────────────┘                    ┌─────────────┴─┴─┴────┐  │
│  Xrm.App.sidePanes ◄── OpenInvoices                   │ M365 Copilot panel   │  │
│                                                       │  Collections agent   │  │
│                                                       │  (declarative)       │  │
│                                                       │  ui:// widgets ──────┼──┼── postMessage
└───────────────────────────────────────────────────────┴───────┬──────────────┘  │   powerapps.copilot.chat.action
                                                                │ MCP (Streamable HTTP, Entra SSO)
                                                     ┌──────────▼───────────┐
                                                     │ MCP Apps server      │  Azure Container Apps
                                                     │  6 tools, 2 widgets  │
                                                     └──────────┬───────────┘
                                                                │ Dataverse Web API (OBO, as the user)
                         Dataverse ── BC virtual tables (dyn365bc_*) ── Business Central
                                   └─ contoso_collectiondashboard / contoso_collectionaction (local)
```

## Repository map

| Path | Role | Notes |
|---|---|---|
| `packages/contract` | **The bridge contract** (v1.0): action ids, payload schemas (zod), context shape, `DashboardSpec`, allow-list guard, postMessage/Adaptive Card builders | Imported by the PCF, the MCP server, the widgets and the mock |
| `packages/collections-domain` | Pure logic: aging, payment behaviour, prioritisation, FetchXML builders, Dataverse row mapping, schema constants, fixtures | ~100% line coverage |
| `packages/collections-ui` | React + Fluent UI v9 `AgingDashboard` (SVG stacked bars + matrix), `PriorityList`, `InvoiceCard` | Same components in the PCF and in the widgets |
| `mcp-server` | MCP server (`@modelcontextprotocol/sdk` 1.32, Streamable HTTP, stateless) + MCP Apps (`@modelcontextprotocol/ext-apps` 1.7) | `DATA_MODE=mock\|dataverse` |
| `mcp-server/widgets` | Two single-file widgets (Vite + `vite-plugin-singlefile`) | `ui://collections/priority-list`, `ui://collections/aging-dashboard` |
| `agent` | M365 Agents Toolkit declarative agent | `mcp-tools.json` is generated from the server |
| `pcf/CollectionsBridge` | React virtual PCF control | Builds with `pcf-scripts` (React/Fluent are platform libraries) |
| `dataverse` | Table definitions, solution description, `pac` scripts | |
| `bc` | Optional AL API page for customer ledger entries | Not compiled here |
| `mock` | Offline demo host: fake model-driven app + fake Copilot pane | `npm run demo` |

## The contract

**App → agent: context** (`CollectionsContext`, sent with `updateContext`):

```ts
{ contractVersion: "1.0", entity: "dyn365bc_customer_v2_0", recordId, customerNo, customerName,
  view: "Overdue invoices", filterXML: "<fetch>…</fetch>", overdueTotal, currency,
  dashboardId?, dashboardVersion?, dashboardFilters? }
```

`toPowerAppsContent()` maps it onto `PowerAppsContent` (`entity`, `filterXML` + extra keys + a one-line
`summary`). The same summary is appended to prompts (`buildGroundedPrompt`) as the fallback for risk #1.

**Agent → app: actions** (`addActionHandler`):

| Action | Payload (validated) | App behaviour |
|---|---|---|
| `Contoso.Collections.OpenInvoices` | `invoiceIds[1..5]`, `invoiceNumbers?` | One side pane per invoice (`Xrm.App.sidePanes.createPane` → `pane.navigate(entityrecord)`) |
| `Contoso.Collections.ShowWorklist` | `title`, `fetchXml` (invoice table only), `invoiceIds?` (rank order) | Runs the FetchXML, re-orders by rank, renders the list in the control; with `worklistViewId` also `navigateTo` the saved view |
| `Contoso.Collections.RenderDashboard` | `dashboardId` and/or `spec` | Persists the spec (LWW) to `contoso_collectiondashboard`, renders `<AgingDashboard>`, republishes context |
| `Contoso.Collections.LogFollowUp` | `customerNo`, `note`, `promiseDate?`, `promisedAmount?` | Confirm dialog, then creates a `contoso_collectionaction` row. Never writes BC |
| `MS.PA.CopilotChat.OpenRecord` / `NavigateToView` | built-in | Left to the platform's default handlers |

Every incoming payload goes through `createActionGuard({ allowed, allowedEntities })`. Unknown ids,
malformed payloads, FetchXML against other tables and other contract majors are rejected and audited.

## Data flow per beat

1. **Grounded start.** PCF `updateView` → `bridge.setRecord` → `isM365CopilotEnabled()` → `updateContext()` → `openM365CopilotPanel()` (once). The default agent is *Collections*.
2. **Agent operates the app.** Button → `sendPromptToM365Copilot(prompt + [App context], { gptId })` → agent calls `analyze_payment_behavior` + `prioritize_collections` → the priority-list widget posts `OpenInvoices` + `ShowWorklist` to `window.parent.parent` → the handlers open side panes and show the chase list.
3. **Generative UI, two surfaces.** `build_aging_dashboard` stores a spec and returns spec + data → the dashboard widget renders it and posts `RenderDashboard` → the PCF stores (LWW) and renders the same component from the same spec, then `updateContext({ dashboardId, dashboardVersion, dashboardFilters })`. In-widget changes go `app.callServerTool("update_dashboard")` → re-post `RenderDashboard` → `app.updateModelContext(...)`. In-app changes → spec v+1 (`updatedBy: "app"`) → `updateContext` → the agent calls `get_dashboard` on its next turn.

Shared state is last-write-wins on `spec.version` (ties broken by `updatedAt`). The host cannot push
into a widget (`onhostcontextchanged` is not supported in Copilot), so sync is pull/event driven.

## Why `window.Xrm` in a PCF (and the supported alternative)

PCF controls should use the `context` object; `window.Xrm` is not part of the PCF contract. The
control uses `context.webAPI` for data, and touches `Xrm` only for `Xrm.Copilot` and
`Xrm.App.sidePanes`, which have no PCF equivalent. All access goes through `getXrm()` / `getCopilot()`
in `pcf/CollectionsBridge/CollectionsBridge/bridge/xrm.ts`. When `Xrm.Copilot` is missing, the control
degrades: it still shows data and the dashboard, minus Copilot.

The **supported alternative** is a form script. Register an `OnLoad` handler on the Customer form that
calls `formContext`-derived context → `Xrm.Copilot.updateContext(...)` and registers the action
handlers with `Xrm.Copilot.addActionHandler` (the handlers and guard in `bridge/handlers.ts` and
`bridge/actions.ts` are framework-free and can be bundled into a web resource). The PCF then only
renders `<AgingDashboard>` and the list. The PCF route is used here because it keeps one
component tree and one lifecycle (`destroy()` unregisters handlers).

## MCP server design

- **Stateless Streamable HTTP**: one `McpServer` + transport per POST, so it scales out on Azure Container Apps without sticky sessions. `GET/DELETE /mcp` return 405.
- **Repository interface**: `MockRepository` (fixtures, in-memory dashboards) and `DataverseRepository` (Web API, OBO token per request via `@azure/msal-node`, token validation with `jose` against Entra JWKS, v1 and v2 issuers).
- **Aging in code**: BC virtual tables have limited aggregate/group-by support, so the server (and the PCF) compute aging with `@collections/domain`.
- **Read-only to ERP**: the only writes go to `contoso_collectiondashboard` (server and PCF) and `contoso_collectionaction` (PCF, after confirmation).
- **Widgets**: `registerAppTool(..., { _meta: { ui: { resourceUri } } })` + `registerAppResource(...)` with MIME `text/html;profile=mcp-app` and an empty CSP (single file, no fetches). Read-only tools carry `readOnlyHint: true`, the only annotation Copilot honours.
- **Widget APIs used**: `ontoolinput`, `ontoolresult`, `callServerTool`, `updateModelContext`, `sendMessage`, `getHostCapabilities`, `getHostContext` and auto `sendSizeChanged`. Not used (unsupported in Copilot): `ontoolinputpartial`, `ontoolcancelled`, `onhostcontextchanged`, `onteardown`, `sendLog`.

### Package API notes (checked against the installed `.d.ts`)

- `@modelcontextprotocol/ext-apps` **2.x** targets the split SDK v2 (`@modelcontextprotocol/server`). This repo pins **1.7.x**, which pairs with `@modelcontextprotocol/sdk` 1.x, as the brief asked for. Moving to v2 changes the imports only.
- `App.connect()` defaults to `PostMessageTransport(window.parent, window.parent)`; we pass it explicitly.
- `App.getHostContext()?.theme` is read once at connect (Copilot sends no host-context updates).
- In the mock, the host side is `AppBridge` from `@modelcontextprotocol/ext-apps/app-bridge`, which forwards `tools/call` and `resources/read` to an MCP `Client`.

## Mock host

`mock/` runs the real code paths with fakes only where the platform would be:

- `FakeCopilot` implements the `Xrm.Copilot` surface as an event bus (no-ops when disabled, sequential handlers, built-in defaults). `window.Xrm` is set to a fake with `Copilot`, `App.sidePanes` and `Navigation`.
- The **real** `createCollectionsBridge` (PCF core) and `CollectionsBridgeApp` (PCF UI) run against it.
- The Copilot pane runs the **real MCP server** in-page (`InMemoryTransport`, `MockRepository`) or a running one (`?mcp=http`). A scripted agent picks tools by intent, but all numbers come from tool calls.
- Widgets are the **real built HTML**, loaded in sandboxed iframes via `AppBridge`. Their `postMessage` goes through a relay that only accepts known widget windows, to `FakeCopilot.deliverAction`, and from there to the PCF handlers.
- One shared map stands in for the `contoso_collectiondashboard` table, so in-app edits are visible to `get_dashboard`, as they would be in Dataverse.
