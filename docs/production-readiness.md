# Production-readiness checklist

Seeded from PLAN §6 and extended with what the code does or leaves to you. Status: **✅ in the repo**,
**🔧 configure in the tenant**, **⚠️ verify / decide**. Re-verify GA/preview status against Microsoft
Learn the week before you ship, and date-stamp it.

## Licensing

- [ ] 🔧 A **Microsoft 365 Copilot** licence for every user of the app's Copilot panel and the agent.
- [ ] 🔧 **Dynamics 365 / Power Apps** licences for the model-driven app; a **Business Central** licence for every user whose data access flows through virtual tables.
- [ ] ⚠️ Check whether virtual-table use, Dataverse capacity and Copilot Studio (only if you use `executeEvent`/`executePrompt`) need additional entitlement or metered billing.

## Environment

- [ ] 🔧 Microsoft 365 Copilot enabled at **tenant**, **environment** (PPAC → Features) and **app** level (app settings override).
- [ ] 🔧 **Dataverse search / indexing** on (an input to `isM365CopilotEnabled`).
- [ ] 🔧 **Default agent** = Collections in the app's Copilot settings.
- [ ] 🔧 BC virtual tables enabled; logical names confirmed in `packages/collections-domain/src/schema.ts`.
- [ ] ⚠️ `isM365CopilotEnabled()` caches for **30 minutes**: plan rollouts and support scripts around it.

## Governance

- [ ] 🔧 Agent publish/approval in the **Microsoft 365 admin center**; scope to the collections team.
- [ ] 🔧 **DLP**: classify the MCP connector/endpoint; block it from personal environments.
- [ ] ✅ **Audit of agent-initiated actions**: every handled, rejected or failed action is written to `contoso_collectionaction` (`bridge.ts` → `data.audit`). 🔧 Turn on Dataverse auditing and a retention policy for that table.
- [ ] ⚠️ **Data residency**: the platform adds `geo` to the context; make sure the MCP server runs in the same geography as Dataverse (Container Apps region).
- [ ] ✅ **Read-only to the ERP**: no code path writes to BC. Writes go to `contoso_collectiondashboard` (spec) and `contoso_collectionaction` (audit, follow-ups).

## Security

- [ ] ✅ **Entra token validation** on the MCP server (`AUTH_MODE=entra`: issuer v1/v2, audience, JWKS signature via `jose`). 🔧 Never deploy `AUTH_MODE=none`.
- [ ] ✅ **On-behalf-of** to Dataverse (`@azure/msal-node`): the agent sees exactly what the user may see. 🔧 Prefer the managed identity as a federated credential (`AZURE_MANAGED_IDENTITY_CLIENT_ID`) over secrets.
- [ ] 🔧 **Least-privilege role** *Collections Agent User* (see `dataverse/README.md`): read on BC tables, create/write on the dashboard table, create-only on the audit table.
- [ ] ✅ **Confirm step for any write**: `propose_follow_up` writes nothing; the app shows `openConfirmDialog` before it creates the row.
- [ ] ✅ **Allow-list of action ids** in the PCF (`actionGuard` in `bridge/handlers.ts`): unknown ids are rejected and audited.
- [ ] ✅ **Payload validation** (zod schemas in `packages/contract`): GUID ids, at most 5 side panes, FetchXML restricted to the invoice table, contract major version check, size limits.
- [ ] ✅ **postMessage hygiene** (mock host shows the pattern): accept messages only from known widget windows; widgets build messages through `createChatActionMessage` (validated).
- [ ] ✅ No secrets in the repository: `.env*` git-ignored except examples and placeholders.
- [ ] ⚠️ **Widget sandbox**: widgets render on `{sha256(mcp-domain)}.widget-renderer.usercontent.microsoft.com`. Ours make no network calls (empty CSP). If you add fetches, declare `connectDomains` and set CORS for that origin.
- [ ] 🔧 Container Apps: HTTPS only, min replicas ≥ 1, ingress restricted if possible, image scanning on ACR.
- [ ] ⚠️ `pcf-scripts` pulls an `applicationinsights` version with moderate `npm audit` advisories (build-time only, upstream). Track the next pcf-scripts release.

## ALM

- [ ] ✅ CI: typecheck, unit tests (contract, domain ~100% lines, UI, MCP tools incl. HTTP and Dataverse mapping, PCF bridge, mock host), builds (server bundle, widgets, mock, PCF) in `.github/workflows/ci.yml`.
- [ ] 🔧 One release = **agent package + PCF/solution + MCP server image**. Version them together (`CONTRACT_VERSION` 1.0 in the contract). Breaking contract changes bump the major; the PCF rejects unknown majors.
- [ ] 🔧 Solution: unmanaged in dev → `pac solution clone/sync` → managed import to test/prod (`dataverse/scripts/solution.sh`). Consider Power Platform Pipelines.
- [ ] 🔧 Agent: Agents Toolkit `provision` per environment (`env/.env.<env>`); regenerate `mcp-tools.json` with `npm run export:tools -w mcp-server` whenever tools change.
- [ ] 🔧 Server: `az acr build` + `az containerapp update --image` with immutable tags.
- [ ] ⚠️ Telemetry: add Application Insights (OpenTelemetry) to the server and to the PCF's audit path. Not wired yet.

## Gotchas (from the docs and from building this)

- [ ] ⚠️ **Preview APIs**: `executeEvent` / `executePrompt` (Copilot Studio) are preview and not used here. `updateContext` is listed as GA in the reference index but "preview" on the maker page.
- [ ] ⚠️ **Risk #1**: authored agents may not get in-app context. Mitigated: the context also travels in the prompt (`[App context] …`), and the agent can call `get_customer_context`.
- [ ] ⚠️ **MCP Apps host limits in Copilot**: no `ontoolinputpartial`, `ontoolcancelled`, `onhostcontextchanged`, `onteardown` or `sendLog`; only `readOnlyHint` is honoured. Sync is pull/event driven, with last-write-wins on `spec.version`.
- [ ] ⚠️ **Static vs dynamic tool discovery**: with a static `mcp-tools.json`, at least one tool must return a widget (four do).
- [ ] ⚠️ **Starter prompts are hidden** when a default agent is set. The *Analyze* button replaces them.
- [ ] ⚠️ **Virtual tables**: limited aggregates and joins, latency per call. Aging is computed in code; keep queries filtered by customer, and page results (`maxPages`).
- [ ] ⚠️ **`window.Xrm` from a PCF** is pragmatic but unsupported. The supported route is a form `OnLoad` script (see `docs/architecture.md`).
- [ ] ⚠️ **Platform libraries**: the control declares React 16.14 / Fluent 9.46 for reach; the shared components avoid React 18-only APIs. pcf-scripts 1.51 also supports React 18.3.1 and Fluent ≤ 9.68 if your environments serve them.
- [ ] ⚠️ Browser note: newer browsers return a Promise from `scrollIntoView`. Don't return it from a React effect (bit us in the mock).
- [ ] ⚠️ Widget size: each single-file widget is ~0.8 MB (React + Fluent + zod + MCP Apps SDK). Fine for Copilot; trim with Preact or fewer Fluent components if load time matters.

## Open VERIFY points (code comments `// VERIFY:`)

| Where | What to check |
|---|---|
| `packages/contract/src/context.ts` | Which `PowerAppsContent` keys beyond `entity`/`filterXML` reach a declarative agent |
| `pcf/…/bridge/context.ts` | `updateContext` reaches the declarative agent at all (risk #1) |
| `pcf/…/bridge/xrm.ts` | `sendPromptToM365Copilot` option names (`gptId`, auto-submit); `removeActionHandler` signature |
| `pcf/…/bridge/handlers.ts` | Handler receives `actionData` vs the full envelope (both handled) |
| `pcf/…/bridge/actions.ts` | `navigateTo(entitylist)` + saved view for ShowWorklist vs built-in `NavigateToView` |
| `pcf/…/index.ts` | `context.mode.contextInfo.entityId` (widely used, untyped) |
| `pcf/…/ControlManifest.Input.xml` | Platform library versions served by your environment |
| `mcp-server/widgets/src/host.ts` | `window.parent.parent` is the right target in the Copilot-in-app host |
| `packages/collections-domain/src/schema.ts` | BC virtual table column / entity set names; custom ledger API table name; lookup name |
| `packages/collections-domain/src/dataverse-mapping.ts` | Invoice status surfaces as text or choice |
| `agent/m365agents.yml`, `agent/appPackage/*.json` | Toolkit schema versions; `RemoteMCPServer` runtime shape; Entra SSO registration details |
| `docs/setup.md` §6.7 | `gptId` format (read it with `Xrm.Copilot.getCurrentAgent()`) |
| `dataverse/tables/contoso_collectiondashboard.json` | Native → virtual table lookup support |
