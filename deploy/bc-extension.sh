#!/usr/bin/env bash
# Compiles bc/CollectionsLedgerApi (AL) and installs it in Business Central as a per-tenant extension
# through the automation API. Then makes its API visible as a Dataverse virtual table.
#
#   bash deploy/bc-extension.sh [--dry-run]
#
# Needs: the AL CLI (dotnet tool install -g Microsoft.Dynamics.BusinessCentral.Development.Tools --prerelease),
# az signed in with BC permissions (extension management) in the tenant, and deploy/tenant.env.
# Symbols come from Microsoft's public symbol feeds (the environment's dev endpoint refused symbol
# downloads for this Production environment). Bump "version" in app.json before re-publishing a change.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
REPO_ROOT=$(cd "$HERE/.." && pwd)
source "$HERE/lib.sh"
load_tenant_env
require_vars DATAVERSE_URL BC_ENVIRONMENT BC_COMPANY
DRY=0; [[ "${1:-}" == "--dry-run" ]] && DRY=1
export PATH="$PATH:$HOME/.dotnet/tools" DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1
need al "dotnet tool install -g Microsoft.Dynamics.BusinessCentral.Development.Tools --prerelease"
PROJ="$REPO_ROOT/bc/CollectionsLedgerApi"
VERSION=$(node -p 'require(process.argv[1]).version' "$PROJ/app.json")
APP="$PROJ/bin/PowerPlatformNinja_CollectionsLedgerAPI_${VERSION}.app"

log "Symbols (BC ${BC_COMPANY%% *} localization from tenant.env: es) and compile ${VERSION}"
al downloadsymbols --project "$PROJ" --packagecachepath "$PROJ/.alpackages" --globalsourcesonly --symbolscountryregion "${BC_SYMBOLS_COUNTRY:-es}" --raw >/dev/null
mkdir -p "$PROJ/bin"
al compile "/project:$PROJ" "/packagecachepath:$PROJ/.alpackages" "/out:$APP" | grep -E "error|warning" && die "compile failed" || true
[[ -f "$APP" ]] || die "no .app produced"
ok "$(basename "$APP")"

TENANT=$(az account show --query tenantId -o tsv)
BT=$(az account get-access-token --resource https://api.businesscentral.dynamics.com --query accessToken -o tsv)
API="https://api.businesscentral.dynamics.com/v2.0/${TENANT}/${BC_ENVIRONMENT}/api"
CID=$(curl -sf -G -H "Authorization: Bearer $BT" "$API/v2.0/companies" --data-urlencode "\$filter=name eq '${BC_COMPANY}'" \
  | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>console.log(JSON.parse(s).value[0]?.id??""))')
[[ -n "$CID" ]] || die "company ${BC_COMPANY} not found"
AUTO="$API/microsoft/automation/v2.0/companies(${CID})"

if [[ $DRY == 1 ]]; then
  echo "[dry-run] POST $AUTO/extensionUpload; PATCH .../extensionContent ($APP); POST .../Microsoft.NAV.upload; poll extensionDeploymentStatus"
  echo "[dry-run] Dataverse: dyn365bc_businesscentralentities customerledgerentry_ppn_collections_v1_0 -> dyn365bc_hasbeengenerated=true"
  exit 0
fi
log "Install in ${BC_ENVIRONMENT} (per-tenant extension)"
UP=$(curl -sf -X POST "$AUTO/extensionUpload" -H "Authorization: Bearer $BT" -H "Content-Type: application/json" \
  -d '{"schedule":"Current version","schemaSyncMode":"Add"}' | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>console.log(JSON.parse(s).systemId))')
curl -sf -o /dev/null -X PATCH "$AUTO/extensionUpload(${UP})/extensionContent" -H "Authorization: Bearer $BT" \
  -H "Content-Type: application/octet-stream" -H "If-Match: *" --data-binary "@$APP"
curl -sf -o /dev/null -X POST "$AUTO/extensionUpload(${UP})/Microsoft.NAV.upload" -H "Authorization: Bearer $BT" -H "Content-Length: 0"
for _ in $(seq 1 60); do
  ST=$(curl -sf -G -H "Authorization: Bearer $BT" "$AUTO/extensionDeploymentStatus" --data-urlencode "\$orderby=startedOn desc" --data-urlencode "\$top=1" \
    | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{const v=JSON.parse(s).value[0];console.log(v?`${v.status} ${v.name} ${v.appVersion}`:"none")})')
  [[ "$ST" == InProgress* ]] || break; sleep 5
done
[[ "$ST" == Completed* ]] || die "deployment: $ST"
ok "$ST"

log "Dataverse virtual table"
ORG=${DATAVERSE_URL%/}
T=$(az account get-access-token --resource "$ORG" --query accessToken -o tsv)
ROW=$(curl -sf -H "Authorization: Bearer $T" -H "Accept: application/json" "$ORG/api/data/v9.2/dyn365bc_businesscentralentities?\$select=dyn365bc_cdsentitylogicalname" \
  | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>console.log(JSON.parse(s).value.find(r=>r.dyn365bc_cdsentitylogicalname==="customerledgerentry_ppn_collections_v1_0")?.dyn365bc_businesscentralentityid??""))')
[[ -n "$ROW" ]] || die "the BC catalog doesn't list customerledgerentry_ppn_collections_v1_0 yet (refresh the catalog in Available Virtual Tables)"
curl -sf -o /dev/null -X PATCH "$ORG/api/data/v9.2/dyn365bc_businesscentralentities(${ROW})" -H "Authorization: Bearer $T" \
  -H "Content-Type: application/json" -H "If-Match: *" -d '{"dyn365bc_hasbeengenerated": true}'
ok "dyn365bc_customerledgerentry_ppn_collections_v1_0 visible"
