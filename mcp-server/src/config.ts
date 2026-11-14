import { z } from "zod";

/** All configuration comes from the environment. See .env.example. No secrets in code. */
const Env = z
  .object({
    PORT: z.coerce.number().int().default(3001),
    DATA_MODE: z.enum(["mock", "dataverse"]).default("mock"),
    /** none = anonymous (dev only); entra = validate Entra bearer tokens. */
    AUTH_MODE: z.enum(["none", "entra"]).default("none"),
    PUBLIC_BASE_URL: z.url().optional(),
    ALLOWED_ORIGINS: z.string().default(""),
    WIDGETS_DIR: z.string().optional(),

    AZURE_TENANT_ID: z.string().optional(),
    AZURE_CLIENT_ID: z.string().optional(),
    /** Accepted audiences (comma separated). Defaults to api://<client id> and <client id>. */
    AZURE_AUDIENCES: z.string().optional(),
    AZURE_CLIENT_SECRET: z.string().optional(),
    AZURE_CLIENT_CERTIFICATE_PATH: z.string().optional(),
    AZURE_CLIENT_CERTIFICATE_THUMBPRINT: z.string().optional(),
    /** User-assigned managed identity configured as a federated credential on the app registration (Azure Container Apps). */
    AZURE_MANAGED_IDENTITY_CLIENT_ID: z.string().optional(),
    /** Workload identity federation with a projected token file (e.g. AKS). */
    AZURE_FEDERATED_TOKEN_FILE: z.string().optional(),
    /** Scope advertised in the protected-resource metadata. */
    MCP_SCOPE: z.string().optional(),

    DATAVERSE_URL: z.url().optional(),
    /** Optional: only BC customers whose number starts with this (e.g. DEMO-C- for the seeded demo data). */
    CUSTOMER_NUMBER_PREFIX: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    if (env.DATA_MODE === "dataverse") {
      for (const key of ["DATAVERSE_URL", "AZURE_TENANT_ID", "AZURE_CLIENT_ID"] as const) {
        if (!env[key]) ctx.addIssue({ code: "custom", path: [key], message: `${key} is required when DATA_MODE=dataverse` });
      }
      if (env.AUTH_MODE !== "entra") ctx.addIssue({ code: "custom", path: ["AUTH_MODE"], message: "DATA_MODE=dataverse needs AUTH_MODE=entra (OBO needs the user's token)" });
      if (!env.AZURE_MANAGED_IDENTITY_CLIENT_ID && !env.AZURE_CLIENT_SECRET && !env.AZURE_CLIENT_CERTIFICATE_PATH && !env.AZURE_FEDERATED_TOKEN_FILE) {
        ctx.addIssue({ code: "custom", path: ["AZURE_CLIENT_SECRET"], message: "a managed identity, certificate, federated token file or client secret is required for OBO" });
      }
    }
    if (env.AUTH_MODE === "entra" && (!env.AZURE_TENANT_ID || !env.AZURE_CLIENT_ID)) {
      ctx.addIssue({ code: "custom", path: ["AZURE_TENANT_ID"], message: "AUTH_MODE=entra needs AZURE_TENANT_ID and AZURE_CLIENT_ID" });
    }
  });

export type Config = z.infer<typeof Env>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid configuration:\n${parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n")}`);
  }
  return parsed.data;
}
