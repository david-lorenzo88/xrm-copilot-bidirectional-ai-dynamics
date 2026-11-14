# Collections Workspace × Microsoft 365 Copilot

Demo code for the session **"Building the Bridge"** (AI ERP Summit, Lisbon, 27 Nov 2026).

Collections Workspace is a model-driven app over **Business Central virtual tables**. It is bridged to
**Microsoft 365 Copilot** in both directions:

- **App → agent**: `Xrm.Copilot.updateContext` (customer, view, filter, dashboard) and `sendPromptToM365Copilot`.
- **Agent → app**: four `Contoso.Collections.*` actions handled with `Xrm.Copilot.addActionHandler`: open invoices in side panes, show a prioritised worklist, render a dashboard, log a follow-up (after confirmation).
- **Generative UI on two surfaces**: an MCP Apps server renders widgets in Copilot, and the app renders the same React component from the same stored spec.

```
packages/contract            versioned bridge contract (actions, payloads, context, DashboardSpec, allow-list)
packages/collections-domain  aging, payment behaviour, prioritisation, FetchXML, fixtures (pure TS)
packages/collections-ui      AgingDashboard · PriorityList · InvoiceCard (React + Fluent UI v9)
mcp-server                   MCP Apps server: 7 tools, 2 ui:// widgets, mock or Dataverse (OBO)
agent                        M365 Agents Toolkit declarative agent (instructions, MCP plugin)
pcf/CollectionsBridge        PCF React control: context publisher, Analyze button, action handlers
dataverse                    table definitions, solution description, pac scripts
bc                           optional AL API page (customer ledger entries)
mock                         offline demo: fake model-driven app + fake Copilot pane, real code paths
docs                         setup, demo script, architecture, production readiness
```

## Quick start (offline, no tenant)

Requires Node 20+.

```bash
npm install
npm run demo          # builds the widgets, opens the mock host on http://localhost:5173
```

The real PCF bridge and components run against a fake `Xrm.Copilot`. The real MCP server runs in the
page with fixture data, and the real widget HTML runs in iframes. Click **Analyze payment behavior**,
then try the prompt chips. See [docs/demo-script.md](docs/demo-script.md).

## Everyday commands

| Command | What it does |
|---|---|
| `npm run ci` | typecheck → tests → builds (everything CI runs) |
| `npm test` | all unit tests (vitest) |
| `npm run dev:server` | MCP server on :3001 in mock mode (`/mcp`, `/healthz`) |
| `npm run demo:http` | mock host + separately running server (`?mcp=http`) |
| `npm run build -w pcf/CollectionsBridge` | `pcf-scripts build` of the control |
| `npm run export:tools -w mcp-server` | regenerate `agent/appPackage/mcp-tools.json` |
| `npm run fixtures:export` | demo data as JSON (to seed a BC sandbox) |
| `npm run smoke -w mock` | Playwright run of all beats against `npm run demo` (optional) |

## Deploying for real

[docs/setup.md](docs/setup.md) covers it end to end: BC virtual tables, the Dataverse solution, the
Entra app registration, Azure Container Apps, provisioning the agent and setting the default agent.
Start with its **Phase 0 checklist**: the platform behaviours marked `VERIFY:` in the code are listed
there and in [docs/production-readiness.md](docs/production-readiness.md).

## Key files (the ones on the slides)

- Context publishing: `pcf/CollectionsBridge/CollectionsBridge/bridge/context.ts`
- Action handler registration: `pcf/CollectionsBridge/CollectionsBridge/bridge/handlers.ts`
- Widget → app `postMessage`: `mcp-server/widgets/src/host.ts`
- Tool + `ui://` resource registration: `mcp-server/src/tools/register.ts`, `mcp-server/src/widgets.ts`
- The contract: `packages/contract/src/actions.ts`
