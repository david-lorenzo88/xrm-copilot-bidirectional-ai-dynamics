# Collections MCP server

MCP server for the Collections declarative agent: 7 tools, 2 MCP Apps widgets, stateless Streamable HTTP.

```bash
npm run dev -w mcp-server            # tsx watch, mock data, http://localhost:3001/mcp
npm run build -w mcp-server          # widgets (dist/widgets/*.html) + bundle (dist/main.js, dist/package.json)
npm start -w mcp-server              # node dist/main.js
npm test -w mcp-server               # tools (in-memory client), HTTP transport, Dataverse mapping
```

| Endpoint | |
|---|---|
| `POST /mcp` | MCP over Streamable HTTP (JSON responses, no sessions) |
| `GET /healthz` | `{ status, dataMode, authMode, widgets }` for probes |
| `GET /.well-known/oauth-protected-resource` | RFC 9728 metadata when `AUTH_MODE=entra` |

| Tool | readOnlyHint | Widget |
|---|---|---|
| `get_customer_context` | ✓ | |
| `analyze_payment_behavior` | ✓ | |
| `prioritize_collections` | ✓ | `ui://collections/priority-list` (posts OpenInvoices + ShowWorklist) |
| `propose_follow_up` | ✓ | `ui://collections/priority-list` (card that posts LogFollowUp) |
| `build_aging_dashboard` | | `ui://collections/aging-dashboard` (posts RenderDashboard) |
| `get_dashboard` | ✓ | `ui://collections/aging-dashboard` |
| `update_dashboard` | | `ui://collections/aging-dashboard` (called by the widget via `callServerTool`) |

Configuration is environment-only: see `.env.example`. `DATA_MODE=mock` needs nothing else;
`DATA_MODE=dataverse` needs `AUTH_MODE=entra`, the Entra ids, `DATAVERSE_URL` and one OBO credential
(managed identity as a federated credential preferred).

## Azure Container Apps

Build from the **repository root** (the bundle inlines the workspace packages):

```bash
az acr build -r <acr> -t collections-mcp:1.0.0 -f mcp-server/Dockerfile .
az containerapp create ... --target-port 3001 --ingress external --min-replicas 1 --user-assigned <identity>
```

Full walkthrough with env vars, identity and probes: [docs/setup.md §5](../docs/setup.md#5-deploy-the-mcp-server-azure-container-apps).
Stateless by design (a new `McpServer` per request), so scale-out needs no session affinity.
