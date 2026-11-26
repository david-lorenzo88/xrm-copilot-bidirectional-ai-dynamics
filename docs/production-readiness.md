# Production-readiness checklist

Seeded from PLAN §6, then corrected by the live build (premium-us + BC CRONUS ES, November 2026; see
[build-chronology.md](build-chronology.md)). Status: **✅ in the repo**, **🔧 configure in the tenant**,
**⚠️ verify / decide**, **🧪 learned in the tenant**. Re-verify GA/preview status against Microsoft Learn
the week before you ship, and date-stamp it.

## Licensing

- [ ] 🔧 A **Microsoft 365 Copilot** licence for every user of the app's Copilot pane and the agent.
- [ ] 🔧 **Dynamics 365 / Power Apps** licences for the model-driven app; a **Business Central** licence for every user whose data access flows through virtual tables (the virtual table provider calls BC as that user).
- [ ] ⚠️ Check whether Dataverse capacity, virtual-table use and Copilot Studio (only if you use `executeEvent`/`executePrompt`) need extra entitlement or metered billing.
- [ ] ⚠️ Azure: one Container App, ACR (Basic), Log Analytics. Low cost, but not zero; set a budget on the resource group.

## Environment and Copilot settings

- [ ] 🧪 **Tenant**: Microsoft 365 admin center → Copilot → Settings → *Business Applications data in Work IQ available to Copilot* (formerly *Dataverse data available in Microsoft Copilot*) → All users or the collections group. It was **None** in the demo tenant: no Copilot button in the app and `isM365CopilotEnabled()` = `false`, with every other switch on.
- [ ] 🔧 **Power Platform admin center → Copilot → Settings → Power Apps → Chat agent → Microsoft Copilot** on for the environment; environment *Features*: *Copilot* and *Dataverse intelligence* on.
- [ ] 🔧 **Environment**: **Dataverse search** on (an input to `isM365CopilotEnabled`).
- [ ] 🧪 **App**: *Enable M365 Copilot in model-driven apps* can be set **per app**. It is the app setting `m365copilotmodelappenabled` = 1 (`deploy/app-settings.sh`). The setting row only shows up after a `PublishXml` of that app.
- [ ] 🧪 **Default agent**: set in the app designer's **Agents** panel (preview). It is stored in the environment variable `ppn_M365CopilotDefaultAgent_<app unique name>` with a value like `T_<id>.declarativeAgent`. Move it with the solution (environment variable value per environment). `deploy/bind-pcf.mjs` reads it to set the control's `gptId`.
- [ ] 🧪 With a default agent set, **starter prompts are hidden** in the pane. The control's *Analyze payment behavior* button replaces them.
- [ ] ⚠️ `isM365CopilotEnabled()` caches for **30 minutes**: plan rollouts and support scripts around it.

## Business Central virtual tables

- [ ] 🔧 BC and Dataverse **linked**; the needed entities made visible in `dyn365bc_businesscentralentities` (`hasbeengenerated = true` generates the table).
- [ ] ✅ Generated names are in `packages/collections-domain/src/schema.ts`: `dyn365bc_customer_v2_0` (set `dyn365bc_customers_v2_0`), `dyn365bc_salesinvoice_v2_0` (lookup `_dyn365bc_customer_customerid_value`), and the custom ledger API `dyn365bc_customerledgerentry_ppn_collections_v1_0`.
- [ ] 🧪 Provider limits found in the tenant, all handled in the builders and tests:
  - any FetchXML `top` returns **one** row (OData `$top` works);
  - `remainingAmount` can't be filtered or ordered: filter on status **Open** (`200000003`) and sort in code;
  - `olderthan-x-days` needs a value of at least **1**;
  - OData `or` across **different** fields is rejected (split the query);
  - custom API pages surface as `<entity>_<publisher>_<group>_<version>`.
- [ ] 🧪 The standard API has **no customer ledger entries** (payment history). `bc/CollectionsLedgerApi` adds a read-only API page (50100, publisher `ppn`, group `collections`, v1.0); install it as a per-tenant extension (`deploy/bc-extension.sh`) and generate its virtual table.
- [ ] ⚠️ Latency per call and limited aggregates and joins: aging is computed in code, queries stay filtered by customer and paged (`maxPages`).
- [ ] ⚠️ A shared environment holds other customers with the same names (CRONUS ES). The demo scopes views and server to `DEMO-C-*` (`CUSTOMER_NUMBER_PREFIX`). In production, scope by company and by the user's own access instead.

## Governance

- [ ] 🔧 Agent publish/approval in the **Microsoft 365 admin center**; scope to the collections team. (The demo agent is sideloaded for the maker only.)
- [ ] 🔧 **DLP**: classify the MCP endpoint/connector; block it from personal environments.
- [ ] ✅ **Audit of agent-initiated actions**: every handled, rejected or failed action is written to `ppn_collectionaction` (`bridge.ts` → `data.audit`). 🔧 Turn on Dataverse auditing and a retention policy for that table.
- [ ] ⚠️ **Data residency**: the platform adds `geo` to the context. The demo runs Dataverse in the US and the Container App in `eastus`; keep the server in the same geography as Dataverse.
- [ ] ✅ **Read-only to the ERP**: no code path writes to BC. Writes go to `ppn_collectiondashboard` (spec) and `ppn_collectionaction` (audit, follow-ups).

## Security

- [ ] ✅ **Entra token validation** on the MCP server (`AUTH_MODE=entra`: issuer v1/v2, audience, JWKS signature via `jose`). `/mcp` answers 401 without a token. 🔧 Never deploy `AUTH_MODE=none`.
- [ ] 🧪 **SSO from Copilot to the MCP server**: an *Entra SSO* registration in the **Teams Developer Portal** (`oAuthConfigurations`), whose `resourceIdentifierUri` (`api://auth-…/<appId>`) becomes an Application ID URI on the app registration. Pre-authorize the token store client (`ab3be6b7-f5df-413d-ac2d-abf1e3fd9c0b`) on `access_as_user`, and accept that audience on the server (`deploy/agent.mjs` does all of it).
- [ ] ✅ **On-behalf-of** to Dataverse (`@azure/msal-node`): the agent sees exactly what the user may see.
- [ ] 🧪 **No client secret**: the app registration trusts the Container App's managed identity through a **federated credential**, and the server uses the identity's token as the OBO client assertion (`AZURE_MANAGED_IDENTITY_CLIENT_ID`).
- [ ] 🔧 **Admin consent** for Dataverse `user_impersonation` on the app registration (granted in the demo tenant).
- [ ] 🔧 **Least-privilege role** *Collections Specialist* (built by app-builder): read on the BC tables, create/write on the dashboard table, create-only on the audit table.
- [ ] ✅ **Confirm step for any write**: `propose_follow_up` writes nothing; the app shows `openConfirmDialog` before it creates the row.
- [ ] ✅ **Allow-list of action ids** in the PCF (`actionGuard` in `bridge/handlers.ts`): unknown ids are rejected and audited.
- [ ] ✅ **Payload validation** (zod schemas in `packages/contract`): GUID ids, at most 5 side panes, FetchXML restricted to the invoice table, contract major version check, size limits.
- [ ] ✅ **postMessage hygiene**: accept messages only from known widget windows; widgets build messages through `createChatActionMessage` (validated).
- [ ] ✅ No secrets in the repository: `.env*`, `deploy/tenant.env`, `deploy/outputs.env` and `agent/.env.dev.local` are git-ignored; only examples and placeholders are tracked.
- [ ] ⚠️ **Widget sandbox**: widgets render on `{sha256(mcp-domain)}.widget-renderer.usercontent.microsoft.com`. Ours make no network calls (empty CSP). If you add fetches, declare `connectDomains` and set CORS for that origin.
- [ ] 🔧 Container Apps: HTTPS only, min replicas ≥ 1 (set by `azure.sh`, no cold starts), ingress restricted if possible, image scanning on ACR.
- [ ] ⚠️ `pcf-scripts` pulls an `applicationinsights` version with moderate `npm audit` advisories (build-time only, upstream). Track the next pcf-scripts release.

## ALM

- [ ] ✅ CI (`.github/workflows/ci.yml`): typecheck, 107 unit tests (contract, domain, UI, MCP tools incl. HTTP and Dataverse mapping, PCF bridge, mock host), builds (server bundle, widgets, mock, PCF) and a tool-catalogue drift check. 🧪 In this repository the job doesn't start (GitHub Actions account/billing block); run `npm test` locally until that is fixed.
- [ ] 🔧 One release = **agent package + PCF/solution + MCP server image + BC extension**. Version them together (`CONTRACT_VERSION` 1.0). Breaking contract changes bump the major; the PCF rejects unknown majors.
- [ ] 🧪 **PCF updates**: `pac pcf push` runs **Publish All** in the environment (avoid it in a shared one). `deploy/pcf-import.sh` builds a wrapper solution with only the control and the environment's own publisher block (name, prefix, option value prefix) and imports it without Publish All. Bump the control version first.
- [ ] 🧪 **Re-bind after app-builder rebuilds**: app-builder rewrites the form, so run `node deploy/bind-pcf.mjs` afterwards (binds the control to the customer number on all three form factors and publishes only that table).
- [ ] 🧪 **app-builder doesn't reapply filters on existing views**: patch the saved query's FetchXML (as done for *Overdue invoices*) or delete and rebuild the view. Unwanted forms in the app (the default *Information* form) need `RemoveAppComponents`; verify with the skill's `verify-model-app.js` (63/63 here).
- [ ] 🔧 Solution: unmanaged in dev → `pac solution clone/sync` → managed import to test/prod (`dataverse/scripts/solution.sh`). Consider Power Platform Pipelines. Leftover wrapper solutions from the demo: `PowerAppsTools_ppn`, `CollectionsBridgeControl`.
- [ ] 🧪 **Agent publishing from CI or a container**: the Agents Toolkit CLI's browser sign-in can't complete there. `deploy/agent.mjs` signs in with a device code (Toolkit client id) and calls the Developer Portal import and the Microsoft 365 package upload directly. Use the admin center publish flow for production.
- [ ] 🔧 Agent: regenerate `mcp-tools.json` with `npm run export:tools -w mcp-server` whenever tools change (CI checks drift).
- [ ] 🧪 Server: `deploy/azure.sh` runs `az acr build` from a **minimal git-tracked context** (the full repository upload failed) and `az containerapp update --image` with immutable tags.
- [ ] 🧪 **BC extension**: compile with the AL CLI against the target's symbols (BC 29.1 ES, runtime 16.0; symbols from the public feeds when the environment's dev endpoint refuses), install through the automation API (`extensionUpload`).
- [ ] ⚠️ Telemetry: Log Analytics collects container logs; Application Insights (OpenTelemetry) for the server and the PCF's audit path is not wired yet.
- [ ] 🔧 **Demo date**: production runs with `DEMO_AS_OF` empty and no `asOfDate` on the control.

## Demo-data seeding (BC API gaps, for anyone replaying `deploy/bc-seed.mjs`)

- 🧪 API v2.0 can't set posting groups, payment method or reminder terms on a customer: the script writes them through the `workflowCustomers` OData page (keyed by `id`), copying a working CRONUS ES customer (NAC, BANCO).
- 🧪 Spanish localisation enforces a maximum days-till-due-date: the script picks a payment term per invoice (14/30/60 DÍAS).
- 🧪 `customerPaymentJournals` can't be posted here: payments go through a general journal batch, with the customer and applies-to invoice set through `workflowGenJournalLines`, then the journal's `post` action. A canary payment is checked first.

## Gotchas (from the docs and from building this)

- [ ] ⚠️ **Preview APIs**: `executeEvent` / `executePrompt` (Copilot Studio) are preview and not used here. `updateContext` is listed as GA in the reference index but "preview" on the maker page. The app designer's Agents panel is preview.
- [ ] 🧪 **Risk #1, refined (26 Nov)**: inside the app the pane **does** give our agent the open record. With the app's context withdrawn and a prompt saying only "this customer", the agent called `get_customer_context` with the record's id, then used `DEMO-C-1001`. What does **not** reach it is our own `updateContext` payload (customer number, view, filter, totals, dashboard version); Microsoft: "Agents you author can't yet use in-app user context". So the app's buttons name the customer and the dashboard version in the prompt, and `get_dashboard` without an id returns the latest dashboard. Consequence: an app can't hide the open record from the agent, so a "no context" demo has to run outside the app.
- [ ] 🧪 **Tool routing in the app pane**: inside the model-driven app the pane grounds on Work IQ, and a vague prompt was answered from Dataverse search (other customers' invoices, no payment history) without calling the MCP server. No manifest field forces action calls. What made it reliable (3/3, then every run): prompts that name the tools ("Use the Collections tools to …"), `behavior_overrides.special_instructions.discourage_model_knowledge`, a plugin `description_for_model` that rules out search results, and step-by-step instructions that name each action. Typed questions about the dashboard also worked once `get_dashboard` needed no id.
- [ ] 🧪 **New chat drops the default agent**: the pane's **+** starts plain Copilot; the default agent applies when the pane opens. Prompts sent with `sendPromptToM365Copilot(…, { gptId })` still reach the agent.
- [ ] 🧪 **Confirmation for writing tools**: Copilot shows a *Confirm* card for any tool without `readOnlyHint` (here `build_aging_dashboard`, `update_dashboard`). Keep it: the tools do write (to Dataverse). The first call of the action also shows *Allow*.
- [ ] 🧪 **Same scope on both surfaces**: the control computes the in-app dashboard itself, so it needs the server's customer scope too (`customerNumberPrefix` property, bound from `CUSTOMER_NUMBER_PREFIX`). Without it the app showed €785k with CRONUS customers while the widget showed €125k.
- [ ] 🧪 **Side panes on click**: opening invoice panes automatically when the widget renders felt intrusive; the widget only sends the worklist on render, panes open from its button.
- [ ] 🧪 **Forms over virtual tables are writable**: a generated BC form has *Save*. The App Spec marks the BC fields `readOnly` on the app's forms (except the customer number the control is bound to; the control never writes it).
- [ ] 🧪 **Widget and control caching**: after a redeploy, an open tab keeps the old control and Copilot can serve the old widget; test in a fresh InPrivate window and a new chat.
- [ ] ⚠️ Copilot first calls `server/discover` (newer MCP method); the SDK answers 400 and Copilot falls back to `initialize`. Harmless; noted so the log doesn't alarm anyone.
- [ ] ⚠️ **MCP Apps host limits in Copilot**: no `ontoolinputpartial`, `ontoolcancelled`, `onhostcontextchanged`, `onteardown` or `sendLog`; only `readOnlyHint` is honoured. Sync is pull/event driven, with last-write-wins on `spec.version`.
- [ ] ⚠️ **Static vs dynamic tool discovery**: with a static `mcp-tools.json`, at least one tool must return a widget (four do).
- [ ] ⚠️ **`window.Xrm` from a PCF** is pragmatic but unsupported. The supported route is a form `OnLoad` script (see `docs/architecture.md`).
- [ ] ⚠️ **Platform libraries**: the control declares React 16.14 / Fluent 9.46 for reach; the shared components avoid React 18-only APIs.
- [ ] ⚠️ Browser note: newer browsers return a Promise from `scrollIntoView`. Don't return it from a React effect (bit us in the mock).
- [ ] ⚠️ Widget size: each single-file widget is ~0.8 MB (React + Fluent + zod + MCP Apps SDK). Fine for Copilot; trim with Preact or fewer Fluent components if load time matters.

## Open VERIFY points

Resolved in the tenant (15 Nov 2026 end-to-end run):
- BC virtual table and entity set names, the customer lookup, the custom ledger API table name.
- The default-agent id format (`T_<id>.declarativeAgent`, read from the environment variable); `sendPromptToM365Copilot`
  accepts it as `gptId` and submits the prompt.
- Our `updateContext` payload does **not** reach an authored declarative agent, but the pane passes the open record's id (risk #1, see Gotchas).
- `window.parent.parent` is the right target in the Copilot-in-app host: widget actions (`ShowWorklist`, `OpenInvoices`,
  `RenderDashboard`) reach the PCF handlers, and the audit table records each one.
- The Entra SSO registration shape (silent SSO, only the action's *Allow* consent).

Still open (code comments `// VERIFY:`):

| Where | What to check |
|---|---|
| `pcf/…/bridge/xrm.ts` | `removeActionHandler` signature (navigate away and back; handlers must not double-fire) |
| `pcf/…/bridge/actions.ts` | `navigateTo(entitylist)` + saved view for ShowWorklist vs built-in `NavigateToView` (not configured in the demo) |
| `pcf/…/index.ts` | `context.mode.contextInfo.entityId` (widely used, untyped) |
| `pcf/…/ControlManifest.Input.xml` | Platform library versions served by the environment |
| `agent/m365agents.yml` | Toolkit schema versions (the deploy path uses `deploy/agent.mjs` instead) |
| `dataverse/tables/ppn_collectiondashboard.json` | Native → virtual table lookup support for `ppn_customer`; the code keys on `ppn_customerno`, so the demo doesn't depend on it |
| Bonus 2 | `propose_follow_up` itself not run in the tenant; its path (card → `LogFollowUp` → confirm dialog → `ppn_collectionaction` → Notes on the form) was, through *Research online* on 26 Nov |
