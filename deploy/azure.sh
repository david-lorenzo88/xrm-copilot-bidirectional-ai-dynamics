#!/usr/bin/env bash
# Deploys the MCP server to Azure Container Apps and creates its Entra app registration.
#
#   az login --tenant <tenant-id> && az account set --subscription <subscription-id>
#   deploy/azure.sh --dry-run      # print every command and request body; changes nothing, needs no sign-in
#   deploy/azure.sh                # create what is missing, then print a summary and write deploy/outputs.env
#
# Options:
#   --dry-run       print the plan instead of executing it (only local CLI state is read)
#   --rebuild       build and push the image even if this tag already exists in ACR
#   --skip-build    don't build; deploy the newest existing tag (fails if there is none)
#   -h, --help
#
# Settings come from deploy/tenant.env (DATAVERSE_URL, AZURE_LOCATION, AZURE_RESOURCE_GROUP). Optional
# overrides there or in the environment: ACR_NAME, LAW_NAME, CAE_NAME, MI_NAME, CA_NAME, IMAGE_TAG,
# MCP_APP_DISPLAY_NAME.
#
# Safety: everything is create-if-missing. Registers the Microsoft.App, OperationalInsights, ContainerRegistry
# and ManagedIdentity resource providers if needed (additive, subscription-wide, waits). The resource group must be new or already tagged
# project=xrm-copilot-collections; the Entra app is only changed if it carries the same tag (this
# script sets it at creation). Admin consent is NOT granted; the command is printed. No secrets:
# the Container App reaches Dataverse through a user-assigned managed identity that is a federated
# credential of the app registration (AZURE_MANAGED_IDENTITY_CLIENT_ID).
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

REBUILD=0 SKIP_BUILD=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --rebuild) REBUILD=1 ;;
    --skip-build) SKIP_BUILD=1 ;;
    -h|--help) sed -n '2,/^set -euo/p' "$0" | sed '$d'; exit 0 ;;
    *) die "Unknown option $arg (see --help)" ;;
  esac
done
trap 'rc=$?; rm -rf "$WORK_DIR"; ((rc == 0)) || printf "%sERROR%s azure.sh stopped (exit %s). Fix the cause and re-run: finished steps are skipped.\n" "$_R" "$_N" "$rc" >&2' EXIT

need az "Install the Azure CLI: https://aka.ms/azcli"
need node "Node 20+ is needed to build the Graph request bodies."
load_tenant_env
require_vars DATAVERSE_URL AZURE_LOCATION AZURE_RESOURCE_GROUP
DATAVERSE_URL=${DATAVERSE_URL%/}
[[ "$DATAVERSE_URL" =~ ^https://[^/]+\.dynamics\.com$ ]] || die "DATAVERSE_URL must look like https://<org>.crm<N>.dynamics.com (got ${DATAVERSE_URL})."

RG=$AZURE_RESOURCE_GROUP
LOC=$AZURE_LOCATION
TAG="${PROJECT_TAG_KEY}=${PROJECT_TAG_VALUE}"
APP_DISPLAY_NAME=${MCP_APP_DISPLAY_NAME:-xrm-copilot-collections-mcp}
LAW_NAME=${LAW_NAME:-log-xrm-collections}
CAE_NAME=${CAE_NAME:-cae-xrm-collections}
MI_NAME=${MI_NAME:-id-xrm-collections-mcp}
CA_NAME=${CA_NAME:-ca-xrm-collections-mcp}
IMAGE_REPO=collections-mcp
CRM_APP_ID=00000007-0000-0000-c000-000000000000          # Dynamics CRM (Dataverse)
CRM_USER_IMPERSONATION=78ce3f0f-a1ce-49c2-8cde-64b5c0896db4 # fallback; looked up from the tenant below
REDIRECT_URIS=(https://teams.microsoft.com/api/platform/v1.0/oAuthConsentRedirect https://teams.microsoft.com/api/platform/v1.0/oAuthRedirect)
GRAPH=https://graph.microsoft.com/v1.0
# The port the server listens on (mcp-server/src/config.ts default, set in the Dockerfile).
PORT=$(grep -oE 'PORT=[0-9]+' "${REPO_ROOT}/mcp-server/Dockerfile" | head -1 | cut -d= -f2)
PORT=${PORT:-3001}

# Queries that fail when the resource is missing: "" means missing.
try_query() {
  local placeholder=$1; shift
  if [[ "$DRY_RUN" == 1 ]]; then query "$placeholder" "$@"; else "$@" 2>/dev/null || true; fi
}
hash8() { if command -v sha1sum >/dev/null; then sha1sum; else shasum; fi | cut -c1-8; }

# ---------------------------------------------------------------- account
log "Azure account"
if acct=$(local_probe az account show --query "join(' ', [tenantId, id, name])" -o tsv) && [[ -n "$acct" ]]; then
  read -r TENANT_ID SUB_ID SUB_NAME <<<"$acct"
  ok "subscription ${SUB_NAME:-?} (${SUB_ID}), tenant ${TENANT_ID}"
elif [[ "$DRY_RUN" == 1 ]]; then
  TENANT_ID="<tenant-id>" SUB_ID="<subscription-id>"
  warn "not signed in to az: using placeholders (live run needs: az login --tenant <tenant-id>)"
else
  die "Not signed in. Run: az login --tenant <tenant-id> && az account set --subscription <subscription-id>"
fi
if [[ "$SUB_ID" == "<subscription-id>" ]]; then ACR_NAME=${ACR_NAME:-acrxrmcoll'<hash8(subscription/rg)>'}; else ACR_NAME=${ACR_NAME:-acrxrmcoll$(printf '%s' "${SUB_ID}/${RG}" | hash8)}; fi

log "Resource providers"
# Registering a provider is additive (it changes no existing resource) and is needed once per subscription.
for ns in Microsoft.App Microsoft.OperationalInsights Microsoft.ContainerRegistry Microsoft.ManagedIdentity; do
  state=$(query NotRegistered az provider show -n "$ns" --query registrationState -o tsv)
  if [[ "$state" == Registered ]]; then ok "$ns"; else
    run az provider register -n "$ns" --wait -o none
  fi
done

# ---------------------------------------------------------------- resource group
log "Resource group ${RG} (${LOC})"
if [[ "$(query false az group exists -n "$RG")" == true ]]; then
  rg_tag=$(query "$PROJECT_TAG_VALUE" az group show -n "$RG" --query "tags.${PROJECT_TAG_KEY}" -o tsv)
  [[ "$rg_tag" == "$PROJECT_TAG_VALUE" ]] || die "Resource group ${RG} exists but is not tagged ${TAG}. This script only deploys into a group it created. Choose another AZURE_RESOURCE_GROUP."
  ok "exists, tagged ${TAG}"
else
  run az group create -n "$RG" -l "$LOC" --tags "$TAG" -o none
fi

# ---------------------------------------------------------------- Log Analytics + Container Apps environment
log "Log Analytics workspace ${LAW_NAME}"
if [[ -z "$(try_query "" az monitor log-analytics workspace show -g "$RG" -n "$LAW_NAME" --query id -o tsv)" ]]; then
  run az monitor log-analytics workspace create -g "$RG" -n "$LAW_NAME" -l "$LOC" --tags "$TAG" -o none
else ok "exists"; fi

log "Container Apps environment ${CAE_NAME}"
if [[ -z "$(try_query "" az containerapp env show -g "$RG" -n "$CAE_NAME" --query id -o tsv)" ]]; then
  law_customer_id=$(query "<law-customer-id>" az monitor log-analytics workspace show -g "$RG" -n "$LAW_NAME" --query customerId -o tsv)
  law_key=$(query "<law-shared-key>" az monitor log-analytics workspace get-shared-keys -g "$RG" -n "$LAW_NAME" --query primarySharedKey -o tsv)
  REDACT_VALUES+=("$law_key")
  run az containerapp env create -g "$RG" -n "$CAE_NAME" -l "$LOC" --logs-workspace-id "$law_customer_id" --logs-workspace-key "$law_key" --tags "$TAG" -o none
  unset law_key
else ok "exists"; fi
CAE_DOMAIN=$(query "<env-default-domain>" az containerapp env show -g "$RG" -n "$CAE_NAME" --query properties.defaultDomain -o tsv)
FQDN="${CA_NAME}.${CAE_DOMAIN}"

# ---------------------------------------------------------------- registry + image
log "Container registry ${ACR_NAME} (Basic)"
ACR_ID=$(try_query "" az acr show -g "$RG" -n "$ACR_NAME" --query id -o tsv)
if [[ -z "$ACR_ID" ]]; then
  [[ "$(query true az acr check-name -n "$ACR_NAME" --query nameAvailable -o tsv)" == true ]] \
    || die "ACR name ${ACR_NAME} is taken by another registry (names are global). Set ACR_NAME=<unique, 5-50 alphanumerics> in deploy/tenant.env."
  run az acr create -g "$RG" -n "$ACR_NAME" -l "$LOC" --sku Basic --admin-enabled false --tags "$TAG" -o none
  ACR_ID=$(query "<acr-resource-id>" az acr show -g "$RG" -n "$ACR_NAME" --query id -o tsv)
else ok "exists"; fi
ACR_LOGIN="${ACR_NAME}.azurecr.io"

log "Image ${IMAGE_REPO} (build context: repository root, -f mcp-server/Dockerfile)"
if [[ -z "${IMAGE_TAG:-}" ]]; then
  IMAGE_TAG=$(git -C "$REPO_ROOT" rev-parse --short=12 HEAD 2>/dev/null || echo manual)
  if [[ -n "$(git -C "$REPO_ROOT" status --porcelain 2>/dev/null)" ]]; then IMAGE_TAG="${IMAGE_TAG}-dirty-$(date -u +%Y%m%d%H%M%S)"; fi
fi
if [[ "$SKIP_BUILD" == 1 ]]; then
  IMAGE_TAG=$(query "<latest-tag>" az acr repository show-tags -n "$ACR_NAME" --repository "$IMAGE_REPO" --orderby time_desc --top 1 -o tsv)
  [[ -n "$IMAGE_TAG" ]] || die "--skip-build: no image in ${ACR_NAME}/${IMAGE_REPO} yet."
  ok "using existing tag ${IMAGE_TAG}"
elif [[ "$REBUILD" == 1 || -z "$(try_query "" az acr repository show-tags -n "$ACR_NAME" --repository "$IMAGE_REPO" --query "[?@=='${IMAGE_TAG}'] | [0]" -o tsv)" ]]; then
  # Upload only the git-tracked files the Dockerfile needs (~1 MB). Uploading the whole repository
  # (~76 MB) made ACR Tasks fail with "failed to download context".
  CTX=$(mktemp -d)
  git -C "$REPO_ROOT" ls-files package.json package-lock.json tsconfig.base.json .dockerignore packages mcp-server \
    mock/package.json pcf/CollectionsBridge/package.json | (cd "$REPO_ROOT" && tar -cf - -T -) | tar -xf - -C "$CTX"
  run az acr build -r "$ACR_NAME" -t "${IMAGE_REPO}:${IMAGE_TAG}" -f "${CTX}/mcp-server/Dockerfile" "$CTX"
  rm -rf "$CTX"
else ok "tag ${IMAGE_TAG} already in ACR (use --rebuild to build again)"; fi
IMAGE="${ACR_LOGIN}/${IMAGE_REPO}:${IMAGE_TAG}"

# ---------------------------------------------------------------- managed identity
log "User-assigned managed identity ${MI_NAME}"
if [[ -z "$(try_query "" az identity show -g "$RG" -n "$MI_NAME" --query id -o tsv)" ]]; then
  run az identity create -g "$RG" -n "$MI_NAME" -l "$LOC" --tags "$TAG" -o none
else ok "exists"; fi
read -r MI_ID MI_CLIENT_ID MI_PRINCIPAL_ID <<<"$(query "<mi-resource-id> <mi-client-id> <mi-principal-id>" az identity show -g "$RG" -n "$MI_NAME" --query "join(' ', [id, clientId, principalId])" -o tsv)"
[[ -n "${MI_PRINCIPAL_ID:-}" ]] || die "Could not read the managed identity ${MI_NAME}."

log "AcrPull for the identity on ${ACR_NAME}"
if [[ -z "$(query "" az role assignment list --assignee "$MI_PRINCIPAL_ID" --scope "$ACR_ID" --role AcrPull --query "[0].id" -o tsv)" ]]; then
  run az role assignment create --assignee-object-id "$MI_PRINCIPAL_ID" --assignee-principal-type ServicePrincipal --role AcrPull --scope "$ACR_ID" -o none
else ok "assigned"; fi

# ---------------------------------------------------------------- Entra app registration
log "Entra app registration '${APP_DISPLAY_NAME}'"
apps=$(query "" az ad app list --display-name "$APP_DISPLAY_NAME" --query "[].join(' ', [appId, id])" -o tsv)
app_count=$(grep -c . <<<"$apps" || true)
((app_count <= 1)) || die "${app_count} app registrations are named '${APP_DISPLAY_NAME}'. Resolve that by hand (this script never deletes), or set MCP_APP_DISPLAY_NAME."
if ((app_count == 0)); then
  node -e 'const [n,t]=process.argv.slice(1);process.stdout.write(JSON.stringify({displayName:n,signInAudience:"AzureADMyOrg",tags:[t]}))' "$APP_DISPLAY_NAME" "$TAG" >"$WORK_DIR/app-create.json"
  [[ "$DRY_RUN" == 1 ]] && printf '  body: %s\n' "$(cat "$WORK_DIR/app-create.json")" >&2
  read -r APP_ID APP_OBJ_ID <<<"$(mut "<app-id> <app-object-id>" az rest --method POST --uri "${GRAPH}/applications" --headers Content-Type=application/json --body "@${WORK_DIR}/app-create.json" --query "join(' ', [appId, id])" -o tsv)"
  [[ -n "${APP_OBJ_ID:-}" ]] || die "Creating the app registration returned no id (see the error above)."
  ok "created ${APP_ID}"
  echo '{}' >"$WORK_DIR/app-current.json"
else
  read -r APP_ID APP_OBJ_ID <<<"$apps"
  query "{}" az rest --method GET --uri "${GRAPH}/applications/${APP_OBJ_ID}" >"$WORK_DIR/app-current.json"
  node -e 'const a=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.exit((a.tags||[]).includes(process.argv[2])?0:1)' "$WORK_DIR/app-current.json" "$TAG" \
    || die "App registration '${APP_DISPLAY_NAME}' (${APP_ID}) exists but is not tagged ${TAG}: this script did not create it and will not change it. Rename it or set MCP_APP_DISPLAY_NAME."
  ok "exists (${APP_ID}), tagged ${TAG}"
fi

crm_scope=$(try_query "$CRM_USER_IMPERSONATION" az ad sp show --id "$CRM_APP_ID" --query "oauth2PermissionScopes[?value=='user_impersonation'].id | [0]" -o tsv)
if [[ -z "$crm_scope" ]]; then
  warn "Dynamics CRM service principal not readable; using the well-known user_impersonation id ${CRM_USER_IMPERSONATION}"
  crm_scope=$CRM_USER_IMPERSONATION
fi

# Merge (never replace) the settings we own: api://<appId>, access_as_user, Dataverse
# user_impersonation, the Teams SSO redirect URIs, the project tag.
changed=$(node - "$WORK_DIR/app-current.json" "$APP_ID" "$CRM_APP_ID" "$crm_scope" "$(node -p 'crypto.randomUUID()')" "$TAG" "$WORK_DIR/app-patch.json" "${REDIRECT_URIS[@]}" <<'NODE'
const fs = require("fs");
const [cur, appId, crmApp, crmScope, newScopeId, tag, out, ...redirects] = process.argv.slice(2);
const app = JSON.parse(fs.readFileSync(cur, "utf8") || "{}");
const union = (a = [], b = []) => [...new Set([...a, ...b])];
const api = app.api ?? {};
const scopes = api.oauth2PermissionScopes ?? [];
const hasScope = scopes.some((s) => s.value === "access_as_user");
const rra = structuredClone(app.requiredResourceAccess ?? []);
let crm = rra.find((r) => r.resourceAppId === crmApp);
if (!crm) rra.push((crm = { resourceAppId: crmApp, resourceAccess: [] }));
const hasCrm = crm.resourceAccess.some((a) => a.id === crmScope);
if (!hasCrm) crm.resourceAccess.push({ id: crmScope, type: "Scope" });
const patch = {
  identifierUris: union(app.identifierUris, [`api://${appId}`]),
  api: {
    requestedAccessTokenVersion: 2,
    oauth2PermissionScopes: hasScope ? scopes : [...scopes, {
      id: newScopeId, value: "access_as_user", type: "User", isEnabled: true,
      adminConsentDisplayName: "Use the Collections MCP server as the signed-in user",
      adminConsentDescription: "Lets Microsoft 365 Copilot call the Collections MCP server, which reads Dataverse on behalf of the user.",
      userConsentDisplayName: "Use the Collections agent as you",
      userConsentDescription: "Lets the Collections agent read collections data you can already see.",
    }],
  },
  requiredResourceAccess: rra,
  web: { redirectUris: union(app.web?.redirectUris, redirects) },
  tags: union(app.tags, [tag]),
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const unchanged = hasScope && hasCrm && api.requestedAccessTokenVersion === 2
  && same(patch.identifierUris, app.identifierUris ?? []) && same(patch.web.redirectUris, app.web?.redirectUris ?? []) && same(patch.tags, app.tags ?? []);
fs.writeFileSync(out, JSON.stringify(patch, null, 2) + "\n");
process.stdout.write(unchanged ? "0" : "1");
NODE
)
if [[ "$changed" == 1 ]]; then
  [[ "$DRY_RUN" == 1 ]] && sed 's/^/  body: /' "$WORK_DIR/app-patch.json" >&2
  run az rest --method PATCH --uri "${GRAPH}/applications/${APP_OBJ_ID}" --headers Content-Type=application/json --body "@${WORK_DIR}/app-patch.json"
else ok "API, scope, Dataverse permission and redirect URIs already set"; fi

log "Service principal for ${APP_ID}"
if [[ -z "$(try_query "" az ad sp show --id "$APP_ID" --query id -o tsv)" ]]; then
  run az ad sp create --id "$APP_ID" -o none
else ok "exists"; fi

log "Federated credential: managed identity ${MI_NAME} -> app ${APP_ID}"
FIC_NAME="aca-${MI_NAME}"
fic=$(query "" az ad app federated-credential list --id "$APP_OBJ_ID" --query "[?subject=='${MI_PRINCIPAL_ID}'].name | [0]" -o tsv)
if [[ -z "$fic" ]]; then
  [[ -z "$(query "" az ad app federated-credential list --id "$APP_OBJ_ID" --query "[?name=='${FIC_NAME}'].name | [0]" -o tsv)" ]] \
    || die "A federated credential named ${FIC_NAME} exists with a different subject. Remove it by hand or rename MI_NAME."
  node -e 'const [n,t,s]=process.argv.slice(1);process.stdout.write(JSON.stringify({name:n,issuer:`https://login.microsoftonline.com/${t}/v2.0`,subject:s,audiences:["api://AzureADTokenExchange"],description:"Container App managed identity (xrm-copilot-collections) for the OBO client assertion"}))' \
    "$FIC_NAME" "$TENANT_ID" "$MI_PRINCIPAL_ID" >"$WORK_DIR/fic.json"
  [[ "$DRY_RUN" == 1 ]] && printf '  body: %s\n' "$(cat "$WORK_DIR/fic.json")" >&2
  run az ad app federated-credential create --id "$APP_OBJ_ID" --parameters "@${WORK_DIR}/fic.json" -o none
else ok "exists (${fic})"; fi

# ---------------------------------------------------------------- Container App
ENV_VARS=(
  "PORT=${PORT}" DATA_MODE=dataverse AUTH_MODE=entra "PUBLIC_BASE_URL=https://${FQDN}"
  "DATAVERSE_URL=${DATAVERSE_URL}" "AZURE_TENANT_ID=${TENANT_ID}" "AZURE_CLIENT_ID=${APP_ID}"
  "AZURE_MANAGED_IDENTITY_CLIENT_ID=${MI_CLIENT_ID}"
)
# Optional: scope BC reads to the seeded demo customers (deploy/tenant.env).
[[ -n "${CUSTOMER_NUMBER_PREFIX:-}" ]] && ENV_VARS+=("CUSTOMER_NUMBER_PREFIX=${CUSTOMER_NUMBER_PREFIX}")
# Optional demo date ("today" for ageing). An empty value clears it, back to the real date.
[[ -v DEMO_AS_OF ]] && ENV_VARS+=("DEMO_AS_OF=${DEMO_AS_OF}")
log "Container App ${CA_NAME} (external ingress :${PORT}, min replicas 1)"
if [[ -z "$(try_query "" az containerapp show -g "$RG" -n "$CA_NAME" --query id -o tsv)" ]]; then
  # The AcrPull assignment can take a minute to propagate: retry the first pull.
  for attempt in 1 2 3 4 5; do
    run az containerapp create -g "$RG" -n "$CA_NAME" --environment "$CAE_NAME" \
      --image "$IMAGE" --registry-server "$ACR_LOGIN" --registry-identity "$MI_ID" --user-assigned "$MI_ID" \
      --ingress external --target-port "$PORT" --min-replicas 1 --max-replicas 3 \
      --env-vars "${ENV_VARS[@]}" --tags "$TAG" -o none && break
    ((attempt < 5)) || die "az containerapp create failed 5 times (see above)."
    warn "create failed (attempt ${attempt}); waiting 30s for the AcrPull role to propagate"; sleep 30
  done
else
  run az containerapp update -g "$RG" -n "$CA_NAME" --image "$IMAGE" --min-replicas 1 --set-env-vars "${ENV_VARS[@]}" -o none
fi
real_fqdn=$(query "$FQDN" az containerapp show -g "$RG" -n "$CA_NAME" --query properties.configuration.ingress.fqdn -o tsv)
if [[ -n "$real_fqdn" && "$real_fqdn" != "$FQDN" ]]; then
  warn "ingress FQDN is ${real_fqdn}; updating PUBLIC_BASE_URL"
  FQDN=$real_fqdn
  run az containerapp update -g "$RG" -n "$CA_NAME" --set-env-vars "PUBLIC_BASE_URL=https://${FQDN}" -o none
fi

log "Health check https://${FQDN}/healthz"
health="not checked (dry run)"
if [[ "$DRY_RUN" != 1 ]]; then
  health="FAILED (check: az containerapp logs show -g ${RG} -n ${CA_NAME} --tail 100)"
  for _ in $(seq 1 24); do
    if body=$(curl -fsS --max-time 10 "https://${FQDN}/healthz" 2>/dev/null); then health="OK ${body}"; break; fi
    sleep 10
  done
else printf '%s[dry-run]%s curl -fsS https://%s/healthz\n' "$_Y" "$_N" "$FQDN" >&2; fi

# ---------------------------------------------------------------- outputs
OUTPUTS="# Written by deploy/azure.sh on $(date -u +%Y-%m-%dT%H:%M:%SZ). Non-secret values only.
AZURE_TENANT_ID=${TENANT_ID}
AZURE_SUBSCRIPTION_ID=${SUB_ID}
AZURE_RESOURCE_GROUP=${RG}
ACR_NAME=${ACR_NAME}
MCP_IMAGE=${IMAGE}
MANAGED_IDENTITY_NAME=${MI_NAME}
AZURE_MANAGED_IDENTITY_CLIENT_ID=${MI_CLIENT_ID}
MANAGED_IDENTITY_PRINCIPAL_ID=${MI_PRINCIPAL_ID}
AZURE_CLIENT_ID=${APP_ID}
MCP_APP_OBJECT_ID=${APP_OBJ_ID}
MCP_APP_ID_URI=api://${APP_ID}
MCP_SCOPE=api://${APP_ID}/access_as_user
CONTAINER_APP_NAME=${CA_NAME}
MCP_FQDN=${FQDN}
PUBLIC_BASE_URL=https://${FQDN}
MCP_SERVER_URL=https://${FQDN}/mcp"
if [[ "$DRY_RUN" == 1 ]]; then
  printf '%s[dry-run]%s would write deploy/outputs.env:\n%s\n' "$_Y" "$_N" "$(sed 's/^/  /' <<<"$OUTPUTS")" >&2
else
  printf '%s\n' "$OUTPUTS" >"${DEPLOY_DIR}/outputs.env"
fi

cat >&2 <<EOF

${_B}Summary${_N}
  MCP server     https://${FQDN}/mcp
  Health         ${health}
  App (client)   ${APP_ID}   scope api://${APP_ID}/access_as_user
  Identity       ${MI_NAME} (client ${MI_CLIENT_ID}) federated into the app
  Image          ${IMAGE}
  Outputs        deploy/outputs.env

${_B}Admin consent was NOT granted.${_N} A Global/Privileged Role/Cloud Application admin does one of:
  open  https://login.microsoftonline.com/${TENANT_ID}/adminconsent?client_id=${APP_ID}
  run   az ad app permission admin-consent --id ${APP_ID}
  (grants Dynamics CRM user_impersonation, which the OBO exchange to ${DATAVERSE_URL} needs)

Next:
  1. Teams Developer Portal -> Tools -> Microsoft Entra SSO client ID registration: base URL https://${FQDN},
     client id ${APP_ID}. Put the registration id in agent/env/.env.dev as MCP_AUTH_REFERENCE_ID and compare the
     redirect URI / pre-authorised client it shows with the ones set here (docs/setup.md section 4.4, VERIFY).
  2. agent/env/.env.dev: MCP_SERVER_URL=https://${FQDN}/mcp, then provision the agent (docs/setup.md section 6).
  3. Smoke test: curl https://${FQDN}/.well-known/oauth-protected-resource
EOF
