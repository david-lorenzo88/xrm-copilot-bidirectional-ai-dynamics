#!/usr/bin/env bash
# Turns on "Enable M365 Copilot in model-driven apps" for the Collections Workspace app only
# (an app-level appsetting in the CollectionsWorkspace solution), then publishes that app only.
# The environment-wide setting and every other app are left as they are. Idempotent.
#
#   bash deploy/app-settings.sh [--dry-run]
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
source "$HERE/lib.sh"
load_tenant_env
require_vars DATAVERSE_URL
DRY=0; [[ "${1:-}" == "--dry-run" ]] && DRY=1
ORG=${DATAVERSE_URL%/}
API="$ORG/api/data/v9.2"
APP_UNIQUE=${APP_UNIQUE_NAME:-ppn_collectionsworkspace}
SOLUTION=${SOLUTION:-CollectionsWorkspace}
SETTING=m365copilotmodelappenabled

T=$(az account get-access-token --resource "$ORG" --query accessToken -o tsv)
get() { curl -sf -H "Authorization: Bearer $T" -H "Accept: application/json" -G "$API/$1" "${@:2}"; }
first() { node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{const v=JSON.parse(s).value[0];process.stdout.write(v?String(v[process.argv[1]]):"")})' "$1"; }

log "App ${APP_UNIQUE}: ${SETTING}"
APP=$(get appmodules --data-urlencode "\$select=appmoduleid" --data-urlencode "\$filter=uniquename eq '${APP_UNIQUE}'" | first appmoduleid)
[[ -n "$APP" ]] || die "app ${APP_UNIQUE} not found (build it with app-builder first)"
DEF=$(get settingdefinitions --data-urlencode "\$select=settingdefinitionid" --data-urlencode "\$filter=uniquename eq '${SETTING}'" | first settingdefinitionid)
[[ -n "$DEF" ]] || die "setting ${SETTING} not available in this environment"
# Unpublished app settings are not returned by a plain read; RetrieveUnpublishedMultiple isn't needed:
# a duplicate create fails with a key violation, which we treat as "exists" and then update + publish.
BODY="{\"value\":\"1\",\"settingdefinitionid@odata.bind\":\"/settingdefinitions(${DEF})\",\"parentappmoduleid@odata.bind\":\"/appmodules(${APP})\"}"
if [[ $DRY == 1 ]]; then
  echo "[dry-run] POST $API/appsettings $BODY (header MSCRM.SolutionUniqueName: ${SOLUTION}); then PublishXml for app ${APP}"
  exit 0
fi
code=$(curl -s -o /tmp/appsetting.$$ -w '%{http_code}' -X POST "$API/appsettings" -H "Authorization: Bearer $T" \
  -H "Content-Type: application/json" -H "MSCRM.SolutionUniqueName: ${SOLUTION}" -d "$BODY")
if [[ "$code" == 204 ]]; then ok "created (value 1)"
elif grep -q "violates a database constraint" /tmp/appsetting.$$; then ok "already exists"
else die "create failed ($code): $(head -c 400 /tmp/appsetting.$$)"; fi
rm -f /tmp/appsetting.$$
curl -sf -o /dev/null -X POST "$API/PublishXml" -H "Authorization: Bearer $T" -H "Content-Type: application/json" \
  -d "{\"ParameterXml\":\"<importexportxml><appmodules><appmodule>{${APP}}</appmodule></appmodules></importexportxml>\"}"
VAL=$(get appsettings --data-urlencode "\$select=value" --data-urlencode "\$filter=_parentappmoduleid_value eq ${APP} and _settingdefinitionid_value eq ${DEF}" | first value)
[[ "$VAL" == 1 ]] && ok "published: ${SETTING} = 1 for ${APP_UNIQUE}" || warn "published, but the setting reads '${VAL}'"
