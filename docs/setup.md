# Setup: from an empty tenant to the live demo

Order matters. Each step lists what to check before you go on. Items marked **VERIFY** depend on
tenant behaviour or tooling that we could not test from this repository. Check them during the
Phase 0 spike (PLAN §4).

> Offline only? Skip all of this: `npm install && npm run demo` (see the root README).

## 0. Prerequisites

| Need | Notes |
|---|---|
| Microsoft 365 tenant with **Microsoft 365 Copilot** licences for the demo users | The app's Copilot panel and declarative agents need it |
| **Power Platform environment** with Dataverse, Dynamics 365 / Power Apps licences | Managed Environment recommended |
| **Business Central** online sandbox in the same tenant | Same Entra tenant as Dataverse |
| Azure subscription | Container Apps + Container Registry (+ optional Application Insights) |
| Rights | Entra app registration admin (or an admin to consent), Power Platform environment admin, BC admin, Teams/M365 admin to approve the agent |
| Tools | Node 20+, Power Platform CLI (`pac`), .NET SDK 8+, Azure CLI, Docker (or `az acr build`), VS Code with **Microsoft 365 Agents Toolkit ≥ 6.12** |

## 1. Repository

```bash
npm install
npm run ci            # typecheck + tests + builds (MCP server + widgets, mock, PCF)
npm run demo          # sanity check the offline demo at http://localhost:5173
```

## 2. Business Central virtual tables

1. In the Power Platform admin center, install **Business Central Virtual Table** (AppSource) into the environment.
2. In Business Central, run the **Set up a connection to Dataverse** assisted setup (it installs the matching BC extension, creates the application user and links the company).
3. In Dataverse, open **Available Virtual Tables** (`dyn365bc_businesscentralentity`) and make visible:
   - `customer v2.0` → `dyn365bc_customer_v2_0`
   - `salesInvoice v2.0` → `dyn365bc_salesinvoice_v2_0` (and lines, if you want them)
   - optional: the custom ledger API from `/bc` → expected `dyn365bc_customerledgerentry_v1_0`
4. **VERIFY** the logical **column** names in *Tables → Columns* and fix `packages/collections-domain/src/schema.ts` if they differ (it's the only place they appear). Also check the entity set names (`/api/data/v9.2/EntityDefinitions(LogicalName='dyn365bc_customer_v2_0')?$select=EntitySetName`).
5. Seed data: `npm run fixtures:export` writes ~25 customers and ~300 invoices (`packages/collections-domain/out/fixtures`). The patterns: Fabrikam is the hero (worsening, one €48,500 invoice 100 days overdue), Northwind Traders pays late chronically, Tailspin Toys is improving. Post them in the sandbox (configuration package or the BC API), then shift the dates so they line up with the demo day.
6. Check: the *Overdue invoices* view in Dataverse shows live BC rows.

## 3. Dataverse solution (tables, app, PCF)

See `dataverse/README.md` for every component. In short:

```bash
pac auth create --environment https://yourorg.crm4.dynamics.com
node dataverse/scripts/create-tables.mjs --dry-run            # read the payloads
DATAVERSE_URL=https://yourorg.crm4.dynamics.com \
DATAVERSE_TOKEN=$(az account get-access-token --resource https://yourorg.crm4.dynamics.com --query accessToken -o tsv) \
  node dataverse/scripts/create-tables.mjs --solution ContosoCollections
npm run build:prod -w pcf/CollectionsBridge
dataverse/scripts/solution.sh push        # dev loop: pac pcf push
```

Then in the maker portal, inside the **ContosoCollections** solution:

1. Views *Overdue invoices* and *Chase today* on `dyn365bc_salesinvoice_v2_0`.
2. Customer main form: CollectionsBridge control bound to the customer number, plus an *Overdue invoices* subgrid. Set the control properties (`gptId` after step 6).
3. Model-driven app **Collections Workspace** with the sitemap from `dataverse/README.md`.
4. Security role **Collections Agent User**.
5. `dataverse/scripts/solution.sh clone` to bring it all into source control. After that use `build` / `import`.

Check: open a customer and the control shows *Copilot has context* (after step 8) or *Copilot is off*.

## 4. Entra ID app registration (MCP server)

One registration, **Collections MCP**:

1. **Expose an API**: Application ID URI `api://<client-id>` and a delegated scope `access_as_user`. In *Manifest*, set `requestedAccessTokenVersion` to 2 (the server accepts v1 and v2 issuers anyway).
2. **API permissions**: *Dynamics CRM → user_impersonation* (delegated). Grant admin consent. This is what the on-behalf-of exchange asks for (`<DATAVERSE_URL>/.default`).
3. **Credential for OBO**, in order of preference:
   - **Managed identity as a federated credential** (no secret): create a user-assigned managed identity, add it under *Certificates & secrets → Federated credentials* (scenario *Managed identity*), assign it to the Container App, and set `AZURE_MANAGED_IDENTITY_CLIENT_ID`.
   - A certificate (mount the PEM as a Container Apps secret volume and set `AZURE_CLIENT_CERTIFICATE_PATH` and `AZURE_CLIENT_CERTIFICATE_THUMBPRINT`).
   - A client secret, stored as a Container Apps secret (`AZURE_CLIENT_SECRET`). Never commit it.
4. **Copilot SSO**: in the **Teams Developer Portal → Tools → Microsoft Entra SSO client ID registration**, register the MCP server's base URL and this app's client id. Copy the resulting **registration id** into `agent/env/.env.dev` as `MCP_AUTH_REFERENCE_ID`. Follow the portal's instructions to add its redirect URI / pre-authorise its client for `access_as_user`. **VERIFY**: the exact redirect URI and pre-authorised client id the portal shows today. Copy them from the portal, not from memory.
   - Alternative: OAuth 2.1 (`oauth/register` in `agent/m365agents.yml`, commented out).
   - Development only: `AUTH_MODE=none` on the server and `"auth": { "type": "None" }` in `ai-plugin.json`. Never on a tenant with real data.

## 5. Deploy the MCP server (Azure Container Apps)

```bash
RG=rg-collections; LOC=westeurope; ACR=collectionsacr$RANDOM; APP=collections-mcp; ENVNAME=collections-env
az group create -n $RG -l $LOC
az acr create -g $RG -n $ACR --sku Basic
az acr build -r $ACR -t collections-mcp:1.0.0 -f mcp-server/Dockerfile .      # build context = repo root
az containerapp env create -g $RG -n $ENVNAME -l $LOC
az identity create -g $RG -n collections-mcp-id                              # then add it as a federated credential (step 4.3)
az containerapp create -g $RG -n $APP --environment $ENVNAME \
  --image $ACR.azurecr.io/collections-mcp:1.0.0 --registry-server $ACR.azurecr.io \
  --user-assigned collections-mcp-id --ingress external --target-port 3001 --min-replicas 1 \
  --env-vars DATA_MODE=dataverse AUTH_MODE=entra \
     AZURE_TENANT_ID=<tenant> AZURE_CLIENT_ID=<app-client-id> \
     AZURE_MANAGED_IDENTITY_CLIENT_ID=<identity-client-id> \
     DATAVERSE_URL=https://yourorg.crm4.dynamics.com \
     PUBLIC_BASE_URL=https://<app>.<region>.azurecontainerapps.io
```

- Health: `GET /healthz` (also a Docker `HEALTHCHECK`); configure it as the Container Apps liveness/readiness probe.
- The server is **stateless** (fresh MCP server per request), so it can scale out without session affinity. Keep `--min-replicas 1` for the demo to avoid cold starts.
- `GET /.well-known/oauth-protected-resource` advertises the Entra authority and scope. Unauthenticated calls get `401` with `WWW-Authenticate: Bearer resource_metadata=…`.
- Widgets are served as MCP resources (no separate hosting). Copilot renders them on `{sha256(mcp-domain)}.widget-renderer.usercontent.microsoft.com`. They make no network calls (empty CSP), so no CORS setup is needed for them.
- Try it: `npx @modelcontextprotocol/inspector` → Streamable HTTP → `https://<app>/mcp` (with a bearer token), or in mock mode locally (`npm run dev:server`, then connect to `http://localhost:3001/mcp`; set `ALLOWED_ORIGINS` to the Inspector origin).

## 6. Provision the declarative agent

1. Open `agent/` in VS Code with Agents Toolkit ≥ 6.12. Sign in to Microsoft 365.
2. Fill `agent/env/.env.dev`: `MCP_SERVER_URL=https://<app>.<region>.azurecontainerapps.io/mcp`, `MCP_AUTH_REFERENCE_ID` from step 4.4.
3. Refresh the static tool description if you changed tools: `npm run export:tools -w mcp-server` (writes `agent/appPackage/mcp-tools.json`).
4. **VERIFY** the plugin runtime shape: the `RemoteMCPServer` runtime in `ai-plugin.json` (schema v2.4, `spec.url` + `mcp_tool_description.file`) follows the MCP plugin format we know. If the toolkit offers *Add Action → Start with an MCP server*, run it once in a scratch project and diff. Do the same for the `declarativeAgent.json` schema version (v1.5) and the manifest version (1.19); accept upgrades the toolkit suggests. Some sources describe dynamic tool discovery and others static: with the static file, at least one tool must return a widget (two do).
5. **Provision** (Lifecycle → Provision). The toolkit writes `TEAMS_APP_ID` and `M365_TITLE_ID`.
6. Test in https://m365.cloud.microsoft/chat with the agent selected: "Prioritize today's collections across all customers" should render the priority-list widget.
7. **Agent id for the PCF (`gptId`)**: open Collections Workspace with the Collections agent active in the panel and run `await Xrm.Copilot.getCurrentAgent()` in the browser console. Use the id it returns as the control's `gptId` property. **VERIFY** the id format (commonly `T_<titleId>.declarativeAgent`); trust what `getCurrentAgent()` returns.
8. Governance: publish/approve the agent in the Microsoft 365 admin center (*Agents*) for the demo users.

## 7. Copilot settings for the app

1. Power Platform admin center → environment → **Features**: Microsoft 365 Copilot in model-driven apps **on**. Make sure **Dataverse search** is on.
2. Power Apps → **Collections Workspace** → *Settings* → *Upcoming/Features*: Microsoft 365 Copilot chat **on** (app-level override).
3. The user's licence and rollout flags: `Xrm.Copilot.isM365CopilotEnabled()` checks licence, environment setting, Dataverse indexing, app override and rollout, and **caches the answer for 30 minutes**. After changing settings, use a fresh browser session.

## 8. Set the default agent

In the app's Copilot settings (app designer → *Settings* → *Copilot*), set **Default agent = Collections**.
Note: starter prompts don't render when a default agent is set. The *Analyze payment behavior* button
is the deliberate replacement.

## 9. Phase 0 checklist (do this first, on the real tenant)

| # | Check | How | Fallback |
|---|---|---|---|
| a | `updateContext` reaches the declarative agent | Open Fabrikam, ask "Which customer am I on?" without naming it | The `[App context]` line the PCF appends to prompts; the agent calls `get_customer_context` |
| b | Extra context keys survive (`customerNo`, `dashboardId`…) | Ask "What dashboard is open?" after beat 3 | Same as (a) |
| c | Widget `postMessage` reaches `addActionHandler` | Beat 2: side panes open | Adaptive Card `Action.Submit` with `{ type: "PowerApps", action, actionData }` (`createAdaptiveCardSubmitData`) |
| d | Handler receives `actionData` (not the envelope) | Beat 2 | `unwrap()` in `bridge/handlers.ts` already accepts both |
| e | Side panes open from a handler | Beat 2 | `Xrm.Navigation.navigateTo` a record in a dialog |
| f | `sendPromptToM365Copilot` option names (`gptId`, auto-submit) | Click *Analyze* | Adjust `SendPromptOptions` in `bridge/xrm.ts` |
| g | `removeActionHandler` signature | Navigate away from the form and back; handlers must not double-fire | Adjust `registerActionHandlers` cleanup |
