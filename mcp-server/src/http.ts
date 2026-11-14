import express, { type NextFunction, type Request, type Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { AuthError, createOboTokenProvider, createTokenValidator, type Caller } from "./auth/entra";
import type { Config } from "./config";
import { DataverseClient } from "./repository/dataverse-client";
import { DataverseRepository } from "./repository/dataverse";
import { MockRepository } from "./repository/mock";
import type { CollectionsRepository } from "./repository/types";
import { SERVER_INFO, createCollectionsServer } from "./server";
import type { WidgetSource } from "./widgets";

export interface AppOptions {
  config: Config;
  widgets: WidgetSource;
  widgetStatus?: () => Record<string, boolean>;
}

/**
 * Express app with a stateless Streamable HTTP endpoint: a fresh McpServer per
 * request, so the service scales out on Azure Container Apps without sticky sessions.
 */
export function createApp({ config, widgets, widgetStatus }: AppOptions) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));
  app.use(cors(config.ALLOWED_ORIGINS));

  const validate = config.AUTH_MODE === "entra" ? createTokenValidator(config) : undefined;
  const obo = config.DATA_MODE === "dataverse" ? createOboTokenProvider(config) : undefined;
  const mock = new MockRepository();

  const repositoryFor = (caller: Caller | undefined): CollectionsRepository => {
    if (config.DATA_MODE === "mock") return mock;
    const client = new DataverseClient({ url: config.DATAVERSE_URL!, getToken: () => obo!(caller!.token) });
    return new DataverseRepository(client, { customerNumberPrefix: config.CUSTOMER_NUMBER_PREFIX });
  };

  const resourceMetadataUrl = `${config.PUBLIC_BASE_URL ?? ""}/.well-known/oauth-protected-resource`;

  app.get("/healthz", (_req, res) => {
    res.json({ status: "ok", server: SERVER_INFO, dataMode: config.DATA_MODE, authMode: config.AUTH_MODE, widgets: widgetStatus?.() });
  });

  // RFC 9728 protected-resource metadata, so MCP clients can discover the Entra authority.
  app.get("/.well-known/oauth-protected-resource", (_req, res) => {
    if (config.AUTH_MODE !== "entra") return void res.status(404).end();
    res.json({
      resource: config.PUBLIC_BASE_URL ? `${config.PUBLIC_BASE_URL}/mcp` : undefined,
      authorization_servers: [`https://login.microsoftonline.com/${config.AZURE_TENANT_ID}/v2.0`],
      scopes_supported: [config.MCP_SCOPE ?? `api://${config.AZURE_CLIENT_ID}/access_as_user`],
      bearer_methods_supported: ["header"],
    });
  });

  app.post("/mcp", async (req: Request, res: Response) => {
    let caller: Caller | undefined;
    if (validate) {
      try {
        caller = await validate(req.headers.authorization);
      } catch (err) {
        res.setHeader("WWW-Authenticate", `Bearer resource_metadata="${resourceMetadataUrl}"`);
        return void res.status(401).json({ jsonrpc: "2.0", error: { code: -32001, message: (err as AuthError).message }, id: null });
      }
    }
    const server = createCollectionsServer({ repository: repositoryFor(caller), widgets });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error("[mcp] request failed", err);
      if (!res.headersSent) res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal error" }, id: null });
    }
  });

  // Stateless server: no SSE stream or session to resume / delete.
  const methodNotAllowed = (_req: Request, res: Response) =>
    void res.status(405).set("Allow", "POST").json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null });
  app.get("/mcp", methodNotAllowed);
  app.delete("/mcp", methodNotAllowed);

  return app;
}

/** Small CORS middleware for the MCP Inspector / mock host. Copilot calls server-to-server. */
function cors(allowed: string) {
  const origins = allowed.split(",").map((o) => o.trim()).filter(Boolean);
  return (req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;
    if (origin && (origins.includes("*") || origins.includes(origin))) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID");
      res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id, WWW-Authenticate");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    }
    if (req.method === "OPTIONS") return void res.status(204).end();
    next();
  };
}
