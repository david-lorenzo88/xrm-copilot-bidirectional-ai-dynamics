import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { loadConfig } from "../src/config";
import { createApp } from "../src/http";
import { stubWidgets } from "./helpers";

let server: Server;
let base: string;

beforeAll(async () => {
  const app = createApp({ config: loadConfig({ DATA_MODE: "mock", AUTH_MODE: "none", ALLOWED_ORIGINS: "http://localhost:5173" }), widgets: stubWidgets, widgetStatus: () => ({ priorityList: true }) });
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe("HTTP transport", () => {
  it("serves a health endpoint", async () => {
    const res = await fetch(`${base}/healthz`);
    expect(await res.json()).toMatchObject({ status: "ok", dataMode: "mock", authMode: "none", widgets: { priorityList: true } });
  });

  it("speaks MCP over Streamable HTTP (stateless)", async () => {
    const client = new Client({ name: "http-test", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(7);
    const r = await client.callTool({ name: "prioritize_collections", arguments: { customerNo: "C-1001", limit: 3 } });
    expect((r.structuredContent as { items: unknown[] }).items).toHaveLength(3);
    await client.close();
  });

  it("rejects GET on /mcp and handles CORS preflight", async () => {
    expect((await fetch(`${base}/mcp`)).status).toBe(405);
    const pre = await fetch(`${base}/mcp`, { method: "OPTIONS", headers: { Origin: "http://localhost:5173" } });
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    const other = await fetch(`${base}/healthz`, { headers: { Origin: "https://evil.example" } });
    expect(other.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("config", () => {
  it("requires Entra + Dataverse settings for dataverse mode", () => {
    expect(() => loadConfig({ DATA_MODE: "dataverse" })).toThrow(/DATAVERSE_URL is required/);
    expect(() => loadConfig({ AUTH_MODE: "entra" })).toThrow(/AZURE_TENANT_ID/);
    const ok = loadConfig({
      DATA_MODE: "dataverse",
      AUTH_MODE: "entra",
      DATAVERSE_URL: "https://contoso.crm4.dynamics.com",
      AZURE_TENANT_ID: "t",
      AZURE_CLIENT_ID: "c",
      AZURE_FEDERATED_TOKEN_FILE: "/var/run/token",
    });
    expect(ok.PORT).toBe(3001);
  });

  it("returns 401 with resource metadata when a token is missing", async () => {
    const app = createApp({ config: loadConfig({ AUTH_MODE: "entra", AZURE_TENANT_ID: "contoso-tenant", AZURE_CLIENT_ID: "abc", PUBLIC_BASE_URL: "https://mcp.example.com" }), widgets: stubWidgets });
    const s = app.listen(0);
    await new Promise((r) => s.once("listening", r));
    const url = `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
    const res = await fetch(`${url}/mcp`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain("https://mcp.example.com/.well-known/oauth-protected-resource");
    const meta = await (await fetch(`${url}/.well-known/oauth-protected-resource`)).json();
    expect(meta.authorization_servers[0]).toContain("contoso-tenant");
    await new Promise<void>((r) => s.close(() => r()));
  });
});
