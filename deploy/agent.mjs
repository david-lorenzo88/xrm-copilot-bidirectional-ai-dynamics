#!/usr/bin/env node
/**
 * Publishes the Collections declarative agent (agent/) to Microsoft 365 Copilot.
 *
 * It does what the Agents Toolkit's `provision` stage does (agent/m365agents.yml), but signs in with a
 * device code, so it also works from a remote container where the toolkit CLI's browser sign-in
 * (localhost redirect) can't complete. Idempotent: values are persisted in agent/env/.env.dev and
 * each step is skipped when its output already exists.
 *
 *   node deploy/agent.mjs --dry-run      # plan only
 *   node deploy/agent.mjs                # do it
 *
 * Steps
 *  1. Sign in: device code with the Agents Toolkit's public client; token cache in
 *     $XRM_AGENT_HOME (default ~/.xrm-agent, mode 0600). Needs Teams Developer Portal + MOS scopes.
 *  2. Entra SSO registration in the Teams Developer Portal for the MCP server -> MCP_AUTH_REFERENCE_ID.
 *  3. Entra app (from deploy/outputs.env): expose the registration's Application ID URI, keep the
 *     consent redirect URI, pre-authorize the token store client; the MCP server accepts that audience.
 *  4. Build agent/appPackage/build/appPackage.dev.zip (substitutes ${{VARS}}; fails on unresolved ones).
 *  5. Import into the Teams Developer Portal (create/update) -> TEAMS_APP_ID.
 *  6. Upload to Microsoft 365 (personal scope) so the agent appears in Copilot -> M365_TITLE_ID, M365_APP_ID.
 *
 * Requires: az (signed in, same tenant) for step 3; deploy/outputs.env from deploy/azure.sh.
 */
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DRY = process.argv.includes("--dry-run");
const AGENT = path.join(ROOT, "agent");
const ENV_BASE = path.join(AGENT, "env", ".env.dev"); // committed placeholders
const ENV_FILE = path.join(AGENT, "env", ".env.dev.local"); // git-ignored: tenant-specific values this script writes
const OUTPUTS = path.join(ROOT, "deploy", "outputs.env");
const PKG_DIR = path.join(AGENT, "appPackage");
const BUILD = path.join(PKG_DIR, "build");
const ZIP = path.join(BUILD, "appPackage.dev.zip");

const TOOLKIT_CLIENT_ID = "7ea7c24c-b1f6-4a20-9d11-9ae12e9e7ac0"; // Agents Toolkit public client
const DEV_PORTAL = "https://dev.teams.microsoft.com";
const DEV_PORTAL_SCOPE = "https://dev.teams.microsoft.com/AppDefinitions.ReadWrite";
const MOS = "https://titles.prod.mos.microsoft.com";
const MOS_SCOPE = "https://titles.prod.mos.microsoft.com/.default";
const CONSENT_REDIRECT = "https://teams.microsoft.com/api/platform/v1.0/oAuthConsentRedirect";
// VERIFY: Microsoft's token store client that must be pre-authorized on the API for Entra SSO
// (Microsoft 365 Copilot API plugins / MCP "Microsoft Entra SSO" docs).
const TOKEN_STORE_CLIENT_ID = "ab3be6b7-f5df-413d-ac2d-abf1e3fd9c0b";

const log = (m) => console.log(`==> ${m}`);
const ok = (m) => console.log(` ok ${m}`);
const warn = (m) => console.log(`warn ${m}`);
const die = (m) => {
  console.error(`ERROR ${m}`);
  process.exit(1);
};

// ------------------------------------------------------------------ env files
function readEnv(file) {
  if (!fs.existsSync(file)) return {};
  return Object.fromEntries(
    fs.readFileSync(file, "utf8").split("\n").filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
  );
}
function writeEnv(file, updates) {
  let text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  for (const [k, v] of Object.entries(updates)) {
    const re = new RegExp(`^${k}=.*$`, "m");
    text = re.test(text) ? text.replace(re, `${k}=${v}`) : `${text.replace(/\n?$/, "\n")}${k}=${v}\n`;
  }
  if (DRY) return console.log(`[dry-run] would set in ${path.relative(ROOT, file)}: ${Object.keys(updates).join(", ")}`);
  fs.writeFileSync(file, text);
}

if (!fs.existsSync(ENV_FILE) && !DRY) fs.writeFileSync(ENV_FILE, "# Written by deploy/agent.mjs (git-ignored). Overrides agent/env/.env.dev.\n", { mode: 0o600 });
const env = { ...readEnv(ENV_BASE), ...readEnv(ENV_FILE) };
const out = readEnv(OUTPUTS);
for (const k of ["MCP_SERVER_URL", "PUBLIC_BASE_URL", "AZURE_CLIENT_ID", "MCP_APP_OBJECT_ID", "AZURE_TENANT_ID", "AZURE_RESOURCE_GROUP", "CONTAINER_APP_NAME"]) {
  if (!out[k] && !DRY) die(`${k} missing from deploy/outputs.env: run deploy/azure.sh first.`);
}
const TENANT = out.AZURE_TENANT_ID ?? "<tenant-id>";

// ------------------------------------------------------------------ auth
const require = createRequire(path.join(ROOT, "package.json"));
const msal = require("@azure/msal-node");
const HOME = process.env.XRM_AGENT_HOME ?? path.join(os.homedir(), ".xrm-agent");
const CACHE = path.join(HOME, "msal-cache.json");
let pca;
let account;
async function token(scope) {
  if (DRY) return "<token>";
  if (!pca) {
    fs.mkdirSync(HOME, { recursive: true, mode: 0o700 });
    pca = new msal.PublicClientApplication({
      auth: { clientId: TOOLKIT_CLIENT_ID, authority: `https://login.microsoftonline.com/${TENANT}` },
      cache: {
        cachePlugin: {
          beforeCacheAccess: async (c) => fs.existsSync(CACHE) && c.tokenCache.deserialize(fs.readFileSync(CACHE, "utf8")),
          afterCacheAccess: async (c) => c.cacheHasChanged && fs.writeFileSync(CACHE, c.tokenCache.serialize(), { mode: 0o600 }),
        },
      },
    });
    [account] = await pca.getTokenCache().getAllAccounts();
  }
  if (account) {
    try {
      return (await pca.acquireTokenSilent({ account, scopes: [scope] })).accessToken;
    } catch {
      /* fall through to device code */
    }
  }
  const r = await pca.acquireTokenByDeviceCode({ scopes: [scope], deviceCodeCallback: (d) => console.log(d.message) });
  account = r.account;
  return r.accessToken;
}

async function call(method, url, { scope, json, body, headers = {} } = {}) {
  if (DRY) {
    console.log(`[dry-run] ${method} ${url}`);
    return {};
  }
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${await token(scope)}`, ...(json ? { "Content-Type": "application/json" } : {}), ...headers },
    body: json ? JSON.stringify(json) : body,
  });
  const text = await res.text();
  let data = text;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* keep text */
  }
  if (!res.ok) throw new Error(`${method} ${url} -> ${res.status} ${typeof data === "string" ? data.slice(0, 500) : JSON.stringify(data).slice(0, 500)}`);
  return data;
}

function az(args, { parse = true } = {}) {
  if (DRY) {
    console.log(`[dry-run] az ${args.join(" ")}`);
    return parse ? {} : "";
  }
  const res = execFileSync("az", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return parse ? JSON.parse(res || "null") : res.trim();
}

// ------------------------------------------------------------------ steps
log("Sign-in (Teams Developer Portal + Microsoft 365)");
await token(DEV_PORTAL_SCOPE);
await token(MOS_SCOPE);
ok(DRY ? "skipped (dry run)" : `signed in as ${account?.username}`);

log("Entra SSO registration in the Teams Developer Portal");
let applicationIdUri = env.MCP_AUTH_APPLICATION_ID_URI;
if (env.MCP_AUTH_REFERENCE_ID) {
  ok(`exists: ${env.MCP_AUTH_REFERENCE_ID}`);
} else {
  const reg = await call("POST", `${DEV_PORTAL}/api/v1.0/oAuthConfigurations`, {
    scope: DEV_PORTAL_SCOPE,
    json: {
      description: "xrm-copilot-collections-mcp",
      targetUrlsShouldStartWith: [out.PUBLIC_BASE_URL ?? "<public-base-url>"],
      applicableToApps: "AnyApp",
      m365AppId: "",
      targetAudience: "HomeTenant",
      clientId: out.AZURE_CLIENT_ID ?? "<app-id>",
      identityProvider: "MicrosoftEntra",
      tokenExchangeMethodType: "BasicAuthorizationHeader",
      useSingleSignOn: true,
    },
  });
  const id = reg?.configurationRegistrationId?.oAuthConfigId ?? "<registration-id>";
  applicationIdUri = reg?.resourceIdentifierUri ?? "<resource-identifier-uri>";
  writeEnv(ENV_FILE, { MCP_AUTH_REFERENCE_ID: id, MCP_AUTH_APPLICATION_ID_URI: applicationIdUri });
  env.MCP_AUTH_REFERENCE_ID = id;
  ok(`created ${id} (Application ID URI ${applicationIdUri})`);
}

log(`Entra app ${out.AZURE_CLIENT_ID ?? "<app-id>"}: Application ID URI, redirect URI, pre-authorized token store`);
if (applicationIdUri) {
  const app = az(["rest", "--method", "GET", "--url", `https://graph.microsoft.com/v1.0/applications/${out.MCP_APP_OBJECT_ID}?$select=identifierUris,api,web,tags`]);
  if (!DRY && !(app.tags ?? []).includes("project=xrm-copilot-collections")) die("The app registration does not carry the project tag; refusing to change it.");
  const uris = new Set(app.identifierUris ?? []);
  const scopeId = app.api?.oauth2PermissionScopes?.find((s) => s.value === "access_as_user")?.id;
  if (!DRY && !scopeId) die("The app registration has no access_as_user scope (run deploy/azure.sh).");
  const pre = (app.api?.preAuthorizedApplications ?? []).filter((p) => p.appId !== TOKEN_STORE_CLIENT_ID);
  pre.push({ appId: TOKEN_STORE_CLIENT_ID, delegatedPermissionIds: [scopeId ?? "<scope-id>"] });
  const redirects = new Set(app.web?.redirectUris ?? []);
  redirects.add(CONSENT_REDIRECT);
  uris.add(applicationIdUri);
  const patch = {
    identifierUris: [...uris],
    api: { ...(app.api ?? {}), preAuthorizedApplications: pre },
    web: { ...(app.web ?? {}), redirectUris: [...redirects] },
  };
  delete patch.web.implicitGrantSettings?.["@odata.type"];
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "agent-")), "app.json");
  fs.writeFileSync(tmp, JSON.stringify(patch));
  az(["rest", "--method", "PATCH", "--url", `https://graph.microsoft.com/v1.0/applications/${out.MCP_APP_OBJECT_ID}`, "--headers", "Content-Type=application/json", "--body", `@${tmp}`], { parse: false });
  ok(`identifier URIs: ${patch.identifierUris.join(", ")}`);

  log("MCP server: accept the registration's audience");
  const audiences = [applicationIdUri, `api://${out.AZURE_CLIENT_ID}`, out.AZURE_CLIENT_ID].join(",");
  const current = az(["containerapp", "show", "-g", out.AZURE_RESOURCE_GROUP ?? "<rg>", "-n", out.CONTAINER_APP_NAME ?? "<app>", "--query", "properties.template.containers[0].env"]) ?? [];
  const has = (k, v) => (Array.isArray(current) ? current : []).some((e) => e.name === k && e.value === v);
  const scope = `${applicationIdUri}/access_as_user`;
  if (has("AZURE_AUDIENCES", audiences) && has("MCP_SCOPE", scope)) ok("already configured");
  else {
    az(["containerapp", "update", "-g", out.AZURE_RESOURCE_GROUP ?? "<rg>", "-n", out.CONTAINER_APP_NAME ?? "<app>", "--set-env-vars", `AZURE_AUDIENCES=${audiences}`, `MCP_SCOPE=${scope}`, "-o", "none"], { parse: false });
    ok(`AZURE_AUDIENCES=${audiences}`);
  }
}

log("App package");
const vars = { ...env, MCP_SERVER_URL: out.MCP_SERVER_URL ?? env.MCP_SERVER_URL, TEAMS_APP_ID: env.TEAMS_APP_ID || randomUUID() };
if (!env.TEAMS_APP_ID) writeEnv(ENV_FILE, { TEAMS_APP_ID: vars.TEAMS_APP_ID });
if (vars.MCP_SERVER_URL !== env.MCP_SERVER_URL) writeEnv(ENV_FILE, { MCP_SERVER_URL: vars.MCP_SERVER_URL });
const stage = path.join(BUILD, "stage");
if (!DRY) {
  fs.rmSync(stage, { recursive: true, force: true });
  fs.mkdirSync(stage, { recursive: true });
}
const files = ["manifest.json", "declarativeAgent.json", "instruction.txt", "ai-plugin.json", "mcp-tools.json", "color.png", "outline.png"];
for (const f of files) {
  const src = path.join(PKG_DIR, f);
  if (!fs.existsSync(src)) die(`missing ${path.relative(ROOT, src)}`);
  if (f.endsWith(".png")) {
    if (!DRY) fs.copyFileSync(src, path.join(stage, f));
    continue;
  }
  const text = fs.readFileSync(src, "utf8").replace(/\$\{\{([A-Z0-9_]+)\}\}/g, (m, k) => {
    if (vars[k] === undefined || (vars[k] === "" && k !== "APP_NAME_SUFFIX")) {
      if (DRY) return `<${k}>`;
      die(`${f}: \${{${k}}} has no value (agent/env/.env.dev or deploy/outputs.env)`);
    }
    return vars[k];
  });
  if (!DRY) fs.writeFileSync(path.join(stage, f), text);
}
if (!DRY) {
  fs.rmSync(ZIP, { force: true });
  execFileSync("zip", ["-qj", ZIP, ...files.map((f) => path.join(stage, f))]);
}
ok(`${path.relative(ROOT, ZIP)} (Teams app id ${vars.TEAMS_APP_ID})`);

log("Teams Developer Portal: import (create or update)");
const imported = await call("POST", `${DEV_PORTAL}/api/appdefinitions/v2/import?overwriteIfAppAlreadyExists=true`, {
  scope: DEV_PORTAL_SCOPE,
  body: DRY ? undefined : fs.readFileSync(ZIP),
  headers: { "Content-Type": "application/zip" },
});
ok(`teamsAppId ${imported?.teamsAppId ?? vars.TEAMS_APP_ID}`);

log("Microsoft 365: upload for Copilot (personal scope)");
if (DRY) {
  console.log(`[dry-run] GET ${MOS}/config/v1/environment; POST <titles>/builder/v1/users/packages?scope=Personal; poll <titles>/builder/v1/users/packages/status/<id>`);
} else {
  const { titlesServiceUrl } = await call("GET", `${MOS}/config/v1/environment`, { scope: MOS_SCOPE });
  const form = new FormData();
  form.append("package", new Blob([fs.readFileSync(ZIP)], { type: "application/zip" }), "appPackage.zip");
  form.append("info", JSON.stringify({ builderName: "TeamsToolKit" }));
  const upload = await call("POST", `${titlesServiceUrl}/builder/v1/users/packages?scope=Personal`, { scope: MOS_SCOPE, body: form });
  const statusId = upload?.statusId;
  if (!statusId) die(`upload returned no statusId: ${JSON.stringify(upload).slice(0, 300)}`);
  for (let i = 0; i < 90; i++) {
    const res = await fetch(`${titlesServiceUrl}/builder/v1/users/packages/status/${statusId}`, { headers: { Authorization: `Bearer ${await token(MOS_SCOPE)}` } });
    if (res.status === 200) {
      const s = await res.json();
      writeEnv(ENV_FILE, { M365_TITLE_ID: s.titleId, M365_APP_ID: s.appId });
      ok(`titleId ${s.titleId}, appId ${s.appId}`);
      break;
    }
    if (res.status >= 400) die(`upload status ${res.status}: ${(await res.text()).slice(0, 500)}`);
    await new Promise((r) => setTimeout(r, 2000));
  }
}

console.log(`
Done. Next:
  - Admin consent for the MCP app's Dataverse permission (once):
      https://login.microsoftonline.com/${TENANT}/adminconsent?client_id=${out.AZURE_CLIENT_ID ?? "<app-id>"}
  - In Microsoft 365 Copilot the agent appears as "${"Collections" + (vars.APP_NAME_SUFFIX ?? "")}".
  - The app's default agent: Xrm.Copilot.getCurrentAgent() / the app's Copilot settings (docs/setup.md §7–8).`);
