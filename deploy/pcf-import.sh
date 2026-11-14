#!/usr/bin/env bash
# Deploys the CollectionsBridge PCF without `pac pcf push` (which ends with "Publish All Customizations"
# for the whole environment). Builds a wrapper solution (CollectionsBridgeControl) that holds only the
# control, with the publisher block copied from the environment's existing publisher so the import
# can't change it, then imports it without publishing anything else. Bump the control version in
# pcf/CollectionsBridge/CollectionsBridge/ControlManifest.Input.xml before re-deploying a change.
#
#   bash deploy/pcf-import.sh [--dry-run]
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
REPO_ROOT=$(cd "$HERE/.." && pwd)
source "$HERE/lib.sh"
load_tenant_env
require_vars DATAVERSE_URL
DRY=0; [[ "${1:-}" == "--dry-run" ]] && DRY=1
ORG=${DATAVERSE_URL%/}
PUB_UNIQUE=${PUBLISHER_UNIQUE_NAME:-PowerPlatformNinja}
export DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1

log "Publisher ${PUB_UNIQUE}"
T=$(az account get-access-token --resource "$ORG" --query accessToken -o tsv)
PUB=$(curl -sf -H "Authorization: Bearer $T" -H "Accept: application/json" -G "$ORG/api/data/v9.2/publishers" \
  --data-urlencode "\$select=friendlyname,customizationprefix,customizationoptionvalueprefix" \
  --data-urlencode "\$filter=uniquename eq '${PUB_UNIQUE}'")
read -r PREFIX OPTPREFIX FRIENDLY < <(node -e 'const v=JSON.parse(process.argv[1]).value[0]; if(!v) process.exit(3); console.log(v.customizationprefix, v.customizationoptionvalueprefix, v.friendlyname)' "$PUB") \
  || die "publisher ${PUB_UNIQUE} not found in ${ORG}"
ok "${FRIENDLY} (prefix ${PREFIX}, option value prefix ${OPTPREFIX})"

WORK=$(mktemp -d)
SOL="$WORK/CollectionsBridgeControl"
mkdir -p "$SOL"
log "Build wrapper solution in ${SOL}"
(cd "$SOL" && pac solution init --publisher-name "$PUB_UNIQUE" --publisher-prefix "$PREFIX" >/dev/null \
  && pac solution add-reference --path "$REPO_ROOT/pcf/CollectionsBridge" >/dev/null)
X="$SOL/src/Other/Solution.xml"
# Make the publisher block identical to the environment's, so the import doesn't update it.
sed -i -E "s#<CustomizationOptionValuePrefix>[0-9]+</CustomizationOptionValuePrefix>#<CustomizationOptionValuePrefix>${OPTPREFIX}</CustomizationOptionValuePrefix>#" "$X"
sed -i -E "s#<LocalizedName description=\"${PUB_UNIQUE}\" languagecode=\"1033\" />#<LocalizedName description=\"${FRIENDLY}\" languagecode=\"1033\" />#" "$X"
(cd "$SOL" && dotnet build -c Release -v q -nologo >/dev/null)
ZIP="$SOL/bin/Release/CollectionsBridgeControl.zip"
[[ -f "$ZIP" ]] || die "build produced no zip"
ok "$(basename "$ZIP") ($(du -h "$ZIP" | cut -f1))"

if [[ $DRY == 1 ]]; then
  echo "[dry-run] pac solution import --path $ZIP   (no --publish-changes)"
  exit 0
fi
log "Import (no Publish All)"
pac solution import --path "$ZIP" | grep -E "Imported|Error" || die "import failed"
VER=$(curl -sf -H "Authorization: Bearer $T" -H "Accept: application/json" -G "$ORG/api/data/v9.2/customcontrols" \
  --data-urlencode "\$select=version" --data-urlencode "\$filter=name eq '${PREFIX}_Contoso.CollectionsBridge'" \
  | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>console.log(JSON.parse(s).value[0]?.version??"?"))')
ok "${PREFIX}_Contoso.CollectionsBridge version ${VER} in ${ORG}"
