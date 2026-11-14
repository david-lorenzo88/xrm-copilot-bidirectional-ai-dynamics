import { readFileSync } from "node:fs";
import { ConfidentialClientApplication, type Configuration } from "@azure/msal-node";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import type { Config } from "../config";

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

export interface Caller {
  token: string;
  claims: JWTPayload & { oid?: string; name?: string; preferred_username?: string; scp?: string };
}

/** Validates Entra access tokens issued for this MCP server (v1 or v2 issuer). */
export function createTokenValidator(config: Config) {
  const tenant = config.AZURE_TENANT_ID!;
  const jwks = createRemoteJWKSet(new URL(`https://login.microsoftonline.com/${tenant}/discovery/v2.0/keys`));
  const audiences = config.AZURE_AUDIENCES?.split(",").map((a) => a.trim()) ?? [`api://${config.AZURE_CLIENT_ID}`, config.AZURE_CLIENT_ID!];
  const issuers = [`https://login.microsoftonline.com/${tenant}/v2.0`, `https://sts.windows.net/${tenant}/`];

  return async function validate(authorization: string | undefined): Promise<Caller> {
    const token = /^Bearer\s+(.+)$/i.exec(authorization ?? "")?.[1];
    if (!token) throw new AuthError("missing bearer token");
    try {
      const { payload } = await jwtVerify(token, jwks, { audience: audiences, issuer: issuers });
      return { token, claims: payload };
    } catch (err) {
      throw new AuthError(`invalid token: ${(err as Error).message}`);
    }
  };
}

/** Exchanges the caller's token for a Dataverse token (on-behalf-of flow). */
export function createOboTokenProvider(config: Config) {
  const auth: Configuration["auth"] = {
    clientId: config.AZURE_CLIENT_ID!,
    authority: `https://login.microsoftonline.com/${config.AZURE_TENANT_ID}`,
  };
  if (config.AZURE_CLIENT_SECRET) auth.clientSecret = config.AZURE_CLIENT_SECRET;
  else if (config.AZURE_CLIENT_CERTIFICATE_PATH) {
    auth.clientCertificate = {
      thumbprintSha256: config.AZURE_CLIENT_CERTIFICATE_THUMBPRINT!,
      privateKey: readFileSync(config.AZURE_CLIENT_CERTIFICATE_PATH, "utf8"),
    };
  } else if (config.AZURE_FEDERATED_TOKEN_FILE) {
    const file = config.AZURE_FEDERATED_TOKEN_FILE;
    auth.clientAssertion = async () => readFileSync(file, "utf8").trim();
  }
  const cca = new ConfidentialClientApplication({ auth });
  const scopes = [`${config.DATAVERSE_URL!.replace(/\/+$/, "")}/.default`];

  return async function getDataverseToken(userToken: string): Promise<string> {
    const result = await cca.acquireTokenOnBehalfOf({ oboAssertion: userToken, scopes });
    if (!result?.accessToken) throw new AuthError("on-behalf-of exchange returned no token");
    return result.accessToken;
  };
}
