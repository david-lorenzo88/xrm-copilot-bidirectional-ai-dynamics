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

- [ ] 🔧 **Tenant**: Microsoft 365 Copilot available to the users; *Dataverse data available in Microsoft Copilot* allowed in the Power Platform admin center.
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
- [ ] 🔧 Container Apps: HTTPS only, min replicas ≥ 1 for the session (cold starts), ingress restricted if possible, image scanning on ACR.
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
- [ ] ⚠️ **Risk #1**: declarative agents may not get in-app context. Mitigated: the context also travels in the prompt (`[App context] …`), and the agent can call `get_customer_context`. Not yet confirmed in the tenant.
- [ ] ⚠️ **MCP Apps host limits in Copilot**: no `ontoolinputpartial`, `ontoolcancelled`, `onhostcontextchanged`, `onteardown` or `sendLog`; only `readOnlyHint` is honoured. Sync is pull/event driven, with last-write-wins on `spec.version`.
- [ ] ⚠️ **Static vs dynamic tool discovery**: with a static `mcp-tools.json`, at least one tool must return a widget (four do).
- [ ] ⚠️ **`window.Xrm` from a PCF** is pragmatic but unsupported. The supported route is a form `OnLoad` script (see `docs/architecture.md`).
- [ ] ⚠️ **Platform libraries**: the control declares React 16.14 / Fluent 9.46 for reach; the shared components avoid React 18-only APIs.
- [ ] ⚠️ Browser note: newer browsers return a Promise from `scrollIntoView`. Don't return it from a React effect (bit us in the mock).
- [ ] ⚠️ Widget size: each single-file widget is ~0.8 MB (React + Fluent + zod + MCP Apps SDK). Fine for Copilot; trim with Preact or fewer Fluent components if load time matters.

## Open VERIFY points

Resolved in the tenant: BC virtual table and entity set names, the customer lookup name, the custom
ledger API table name, the default-agent id format (`T_<id>.declarativeAgent`, read from the environment
variable), the Entra SSO registration shape.

Still open (code comments `// VERIFY:`), all needing the end-to-end run in the app:

| Where | What to check |
|---|---|
| `pcf/…/bridge/context.ts`, `packages/contract/src/context.ts` | `updateContext` reaches the declarative agent at all (risk #1), and which keys beyond `entity`/`filterXML` arrive |
| `pcf/…/bridge/xrm.ts` | `sendPromptToM365Copilot` accepts the `T_….declarativeAgent` id as `gptId` and auto-submits; `removeActionHandler` signature |
| `mcp-server/widgets/src/host.ts` | `window.parent.parent` is the right target in the Copilot-in-app host, so widget actions reach the app |
| `pcf/…/bridge/handlers.ts` | Handler receives `actionData` vs the full envelope (both handled) |
| `pcf/…/bridge/actions.ts` | `navigateTo(entitylist)` + saved view for ShowWorklist vs built-in `NavigateToView` |
| `pcf/…/index.ts` | `context.mode.contextInfo.entityId` (widely used, untyped) |
| `pcf/…/ControlManifest.Input.xml` | Platform library versions served by the environment |
| `packages/collections-domain/src/dataverse-mapping.ts` | Invoice status surfaces as text or choice (the code handles both) |
| `agent/m365agents.yml` | Toolkit schema versions (the deploy path uses `deploy/agent.mjs` instead) |
| `dataverse/tables/ppn_collectiondashboard.json` | Native → virtual table lookup support for `ppn_customer`; the code keys on `ppn_customerno`, so the demo doesn't depend on it |
