#!/usr/bin/env bash
# Prepares the Dataverse side: publisher, the CollectionsWorkspace solution, and the PCF control in it.
# Tables, views, forms, the app module and the sitemap belong to the model-apps app-builder skill
# (dataverse/app-builder/app-spec*.json), which must use the publisher and solution this script prints.
#
#   pac auth create --environment <DATAVERSE_URL>      # pac and az signed in as the same maker
#   az login --tenant <tenant-id>
#   deploy/dataverse.sh --dry-run                      # print every command and Web API request; changes nothing
#   deploy/dataverse.sh                                # publisher + solution + PCF
#
# Options:
#   --dry-run          print the plan (reads only local pac/az state; no token, no Web API call)
#   --tables           fallback: also create ppn_collectiondashboard / ppn_collectionaction with
#                      dataverse/scripts/create-tables.mjs (off by default: app-builder owns the tables)
#   --pcf push|import|skip
#                      push   (default) pac pcf push --solution-unique-name CollectionsWorkspace (same command as
#                             dataverse/scripts/solution.sh push, plus the target solution)
#                      import build + import dataverse/solution/CollectionsWorkspace (after solution.sh clone), without
#                             publishing other people's customisations
#                      skip   no PCF
#   -h, --help
#
# Settings: deploy/tenant.env (DATAVERSE_URL, PUBLISHER_PREFIX). Optional: SOLUTION_NAME (CollectionsWorkspace),
# PUBLISHER_UNIQUENAME (PowerPlatformNinja), PUBLISHER_OPTION_PREFIX (57164, only used if a publisher is created).
#
# Safety: refuses to run against any environment other than DATAVERSE_URL. Reuses the existing publisher
# with the prefix (preferring PUBLISHER_UNIQUENAME) and only creates one if none exists. Creates the solution if
# missing and refuses one that is managed or owned by another publisher. Never publishes all customisations
# and never touches other solutions; refuses `pac pcf push` if its temporary PowerAppsTools_<prefix> solution
# already holds anything other than this control.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

WITH_TABLES=0 PCF_MODE=push
while (($#)); do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --tables) WITH_TABLES=1 ;;
    --pcf) PCF_MODE=${2:-}; shift ;;
    --pcf=*) PCF_MODE=${1#--pcf=} ;;
    -h|--help) sed -n '2,29p' "$0"; exit 0 ;;
    *) die "Unknown option $1 (see --help)" ;;
  esac
  shift
done
[[ "$PCF_MODE" =~ ^(push|import|skip)$ ]] || die "--pcf must be push, import or skip"

need pac "Install the Power Platform CLI: https://aka.ms/PowerPlatformCLI"
need az "Install the Azure CLI: https://aka.ms/azcli"
need node "Node 20+ is needed."
need curl ""
load_tenant_env
require_vars DATAVERSE_URL PUBLISHER_PREFIX
DATAVERSE_URL=${DATAVERSE_URL%/}
[[ "$DATAVERSE_URL" =~ ^https://[^/]+\.dynamics\.com$ ]] || die "DATAVERSE_URL must look like https://<org>.crm<N>.dynamics.com (got ${DATAVERSE_URL})."
PREFIX=$PUBLISHER_PREFIX
SOLUTION=${SOLUTION_NAME:-CollectionsWorkspace}
PUBLISHER_UNIQUENAME=${PUBLISHER_UNIQUENAME:-PowerPlatformNinja}
PUBLISHER_FRIENDLY=${PUBLISHER_FRIENDLY:-Power Platform Ninja}
PUBLISHER_OPTION_PREFIX=${PUBLISHER_OPTION_PREFIX:-57164}
CONTROL_NAME="${PREFIX}_Contoso.CollectionsBridge" # <prefix>_<namespace>.<constructor> from ControlManifest.Input.xml
TEMP_SOLUTION="PowerAppsTools_${PREFIX}"             # what `pac pcf push` imports through
API="${DATAVERSE_URL}/api/data/v9.2"
lc() { tr '[:upper:]' '[:lower:]' <<<"${1%/}"; }
# Evaluates a JS expression over JSON on stdin (d = parsed JSON).
js() { node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{const d=s.trim()?JSON.parse(s):{};const r=eval(process.argv[1]);process.stdout.write(r==null?"":String(r))})' "$1"; }
odata_q() { node -p 'encodeURIComponent(process.argv[1])' "$1"; }

# ---------------------------------------------------------------- Web API helpers (token never printed)
DV_TOKEN=""
_curl() {
  local method=$1 url=$2 body=${3:-}
  local extra=()
  [[ -n "$body" ]] && extra+=(-H "Content-Type: application/json" -H "Prefer: return=representation" --data-binary "@${body}")
  curl -sS --fail-with-body -X "$method" -H @<(auth_header "$DV_TOKEN") -H "Accept: application/json" \
    -H "OData-Version: 4.0" -H "OData-MaxVersion: 4.0" ${extra[@]+"${extra[@]}"} "$url"
}
dv_get() { # PATH PLACEHOLDER
  if [[ "$DRY_RUN" == 1 ]]; then printf '%s[dry-run] read:%s GET %s\n' "$_D" "$_N" "${API}/$1" >&2; printf '%s' "$2"; return; fi
  _curl GET "${API}/$1" || die "GET $1 failed (see above)."
}
dv_status() { # PATH -> HTTP status (dry run: 404 = missing)
  if [[ "$DRY_RUN" == 1 ]]; then printf '%s[dry-run] read:%s GET %s\n' "$_D" "$_N" "${API}/$1" >&2; printf 404; return; fi
  curl -sS -o /dev/null -w '%{http_code}' -H @<(auth_header "$DV_TOKEN") -H "Accept: application/json" "${API}/$1"
}
dv_post() { # PATH BODYFILE PLACEHOLDER
  if [[ "$DRY_RUN" == 1 ]]; then printf '%s[dry-run]%s POST %s\n  body: %s\n' "$_Y" "$_N" "${API}/$1" "$(cat "$2")" >&2; printf '%s' "$3"; return; fi
  printf '%s+ POST %s%s\n' "$_D" "${API}/$1" "$_N" >&2
  _curl POST "${API}/$1" "$2" || die "POST $1 failed (see above)."
}

# ---------------------------------------------------------------- 1. pac + az are on DATAVERSE_URL
log "pac auth target"
if [[ "$DRY_RUN" == 1 ]]; then
  active=$(local_probe pac auth list | grep -E '^\[[0-9]+\][[:space:]]+\*' | grep -oE 'https://[A-Za-z0-9.-]+\.dynamics\.com' | head -1 || true)
  printf '%s[dry-run] read:%s pac auth who   (live run refuses unless it reports %s)\n' "$_D" "$_N" "$DATAVERSE_URL" >&2
  if [[ -z "$active" ]]; then warn "no active pac profile (live run needs: pac auth create --environment ${DATAVERSE_URL})"
  elif [[ "$(lc "$active")" != "$(lc "$DATAVERSE_URL")" ]]; then warn "active pac profile is ${active}, not ${DATAVERSE_URL}: a live run would stop here"
  else ok "active pac profile ${active}"; fi
else
  who=$(pac auth who 2>&1) || die "pac auth who failed. Run: pac auth create --environment ${DATAVERSE_URL}"
  match=0
  for u in $(grep -oE 'https://[A-Za-z0-9.-]+\.dynamics\.com' <<<"$who" || true); do
    [[ "$(lc "$u")" == "$(lc "$DATAVERSE_URL")" ]] && match=1
  done
  if ((match == 0)); then
    die "pac is connected to a different environment:
$(grep -iE 'url|environment|connected' <<<"$who" | sed 's/^/  /')
Select ${DATAVERSE_URL}: pac auth create --environment ${DATAVERSE_URL}   (or pac auth select --index <n>)"
  fi
  ok "pac is on ${DATAVERSE_URL}"
fi

log "Web API token (az, resource ${DATAVERSE_URL})"
if [[ "$DRY_RUN" == 1 ]]; then
  printf '%s[dry-run]%s az account get-access-token --resource %s --query accessToken -o tsv   (kept in memory, never printed)\n' "$_Y" "$_N" "$DATAVERSE_URL" >&2
else
  DV_TOKEN=$(az account get-access-token --resource "$DATAVERSE_URL" --query accessToken -o tsv 2>/dev/null) \
    || die "az could not get a token for ${DATAVERSE_URL}. Run: az login --tenant <tenant-id> (as a maker in that environment)."
  me=$(dv_get "WhoAmI" '{}' | js 'd.UserId')
  ok "Web API reachable (user ${me})"
fi

# ---------------------------------------------------------------- 2. publisher
log "Publisher with prefix '${PREFIX}'"
pubs=$(dv_get "publishers?\$select=publisherid,uniquename,friendlyname,customizationprefix&\$filter=$(odata_q "customizationprefix eq '${PREFIX}'")" '{"value":[]}')
pub_lines=$(js 'd.value.map(p=>[p.uniquename,p.publisherid,p.friendlyname].join("\t")).join("\n")' <<<"$pubs")
if [[ -n "$pub_lines" ]]; then
  while IFS=$'\t' read -r u id f; do printf '    found %s (%s) %s\n' "$u" "$f" "$id" >&2; done <<<"$pub_lines"
  chosen=$(awk -F'\t' -v want="$(lc "$PUBLISHER_UNIQUENAME")" 'tolower($1)==want {print; exit}' <<<"$pub_lines")
  if [[ -z "$chosen" ]]; then
    chosen=$(sort <<<"$pub_lines" | head -1)
    warn "no publisher named ${PUBLISHER_UNIQUENAME}; reusing $(cut -f1 <<<"$chosen") (set PUBLISHER_UNIQUENAME to choose another)"
  fi
  IFS=$'\t' read -r PUB_UNIQUE PUB_ID PUB_FRIENDLY <<<"$chosen"
  ok "reusing publisher ${PUB_UNIQUE} (${PUB_FRIENDLY})"
else
  node -e 'const [u,f,p,o]=process.argv.slice(1);process.stdout.write(JSON.stringify({uniquename:u,friendlyname:f,customizationprefix:p,customizationoptionvalueprefix:Number(o),description:"Publisher for xrm-copilot-collections"}))' \
    "$PUBLISHER_UNIQUENAME" "$PUBLISHER_FRIENDLY" "$PREFIX" "$PUBLISHER_OPTION_PREFIX" >"$WORK_DIR/publisher.json"
  PUB_ID=$(dv_post publishers "$WORK_DIR/publisher.json" '{"publisherid":"<new-publisher-id>"}' | js 'd.publisherid')
  PUB_UNIQUE=$PUBLISHER_UNIQUENAME PUB_FRIENDLY=$PUBLISHER_FRIENDLY
  [[ -n "$PUB_ID" ]] || die "Creating the publisher returned no id."
  ok "created publisher ${PUB_UNIQUE}"
fi

# ---------------------------------------------------------------- 3. solution
log "Solution ${SOLUTION}"
sol=$(dv_get "solutions?\$select=solutionid,uniquename,ismanaged,_publisherid_value&\$filter=$(odata_q "uniquename eq '${SOLUTION}'")" '{"value":[]}')
SOL_ID=$(js 'd.value[0]?.solutionid' <<<"$sol")
if [[ -n "$SOL_ID" ]]; then
  [[ "$(js 'd.value[0].ismanaged' <<<"$sol")" == false ]] || die "${SOLUTION} exists as a MANAGED solution: this script will not change it."
  [[ "$(lc "$(js 'd.value[0]._publisherid_value' <<<"$sol")")" == "$(lc "$PUB_ID")" ]] \
    || die "${SOLUTION} exists but belongs to another publisher (not ${PUB_UNIQUE}). Pick another SOLUTION_NAME."
  ok "exists (unmanaged, publisher ${PUB_UNIQUE})"
else
  node -e 'const [u,p]=process.argv.slice(1);process.stdout.write(JSON.stringify({uniquename:u,friendlyname:"Collections Workspace",version:"1.0.0.0",description:"Collections Workspace: model-driven app over Business Central virtual tables, bridged to Microsoft 365 Copilot (xrm-copilot-collections).","publisherid@odata.bind":`/publishers(${p})`}))' \
    "$SOLUTION" "$PUB_ID" >"$WORK_DIR/solution.json"
  SOL_ID=$(dv_post solutions "$WORK_DIR/solution.json" '{"solutionid":"<new-solution-id>"}' | js 'd.solutionid')
  [[ -n "$SOL_ID" ]] || die "Creating the solution returned no id."
  ok "created ${SOLUTION}"
fi

# ---------------------------------------------------------------- 4. tables (fallback only)
TABLES_STATUS="not touched (app-builder owns them; --tables to create them here)"
if [[ "$WITH_TABLES" == 1 ]]; then
  log "Local tables (fallback: dataverse/scripts/create-tables.mjs)"
  [[ "$PREFIX" == ppn ]] || die "--tables: dataverse/tables/*.json use the ppn_ prefix, but PUBLISHER_PREFIX=${PREFIX}."
  present=0
  for t in ppn_collectiondashboard ppn_collectionaction; do
    [[ "$(dv_status "EntityDefinitions(LogicalName='${t}')?\$select=LogicalName")" == 200 ]] && present=$((present + 1))
  done
  if ((present == 2)); then
    ok "both tables exist; skipped"; TABLES_STATUS="already present"
  elif ((present == 1)); then
    die "Only one of ppn_collectiondashboard / ppn_collectionaction exists (a partial earlier run, or app-builder). Finish it in the maker portal; create-tables.mjs is not incremental."
  else
    (
      export DATAVERSE_URL DATAVERSE_TOKEN="$DV_TOKEN"
      if [[ "$DRY_RUN" == 1 ]]; then
        printf '%s[dry-run]%s DATAVERSE_URL=%s DATAVERSE_TOKEN=*** node dataverse/scripts/create-tables.mjs --solution %s   (payloads: node dataverse/scripts/create-tables.mjs --dry-run)\n' "$_Y" "$_N" "$DATAVERSE_URL" "$SOLUTION" >&2
      else
        printf '%s+ node dataverse/scripts/create-tables.mjs --solution %s%s\n' "$_D" "$SOLUTION" "$_N" >&2
        node "${REPO_ROOT}/dataverse/scripts/create-tables.mjs" --solution "$SOLUTION"
      fi
    )
    # Publish only these two tables (never PublishAllXml: that would publish other people's drafts).
    printf '{"ParameterXml":"<importexportxml><entities><entity>ppn_collectiondashboard</entity><entity>ppn_collectionaction</entity></entities></importexportxml>"}' >"$WORK_DIR/publish.json"
    dv_post PublishXml "$WORK_DIR/publish.json" '' >/dev/null
    TABLES_STATUS="created in ${SOLUTION} and published"
  fi
fi

# ---------------------------------------------------------------- 5. PCF control
PCF_STATUS="skipped"
if [[ "$PCF_MODE" != skip ]]; then
  log "PCF ${CONTROL_NAME} -> ${SOLUTION} (${PCF_MODE})"
  ctl=$(dv_get "customcontrols?\$select=customcontrolid,name&\$filter=$(odata_q "name eq '${CONTROL_NAME}'")" '{"value":[]}')
  CTL_ID=$(js 'd.value[0]?.customcontrolid' <<<"$ctl")
  if [[ -n "$CTL_ID" ]]; then
    # Which solutions hold it? Fine: ours, the push temp solution, Default/Active (they hold everything).
    owners=$(dv_get "solutioncomponents?\$select=_solutionid_value&\$filter=$(odata_q "objectid eq ${CTL_ID}")&\$expand=solutionid(\$select=uniquename)" '{"value":[]}' \
      | js 'd.value.map(c=>c.solutionid?.uniquename).filter(Boolean).join(" ")')
    for o in $owners; do
      [[ "$o" == "$SOLUTION" || "$o" == "$TEMP_SOLUTION" || "$o" == Default || "$o" == Active ]] \
        || die "${CONTROL_NAME} already exists and is part of solution ${o}: it is not ours to update."
    done
    ok "control exists (in: ${owners:-no solution}); it will be updated"
  fi

  if [[ "$PCF_MODE" == push ]]; then
    tmp=$(dv_get "solutions?\$select=solutionid&\$filter=$(odata_q "uniquename eq '${TEMP_SOLUTION}'")" '{"value":[]}' | js 'd.value[0]?.solutionid')
    if [[ -n "$tmp" ]]; then
      foreign=$(dv_get "solutioncomponents?\$select=objectid,componenttype&\$filter=$(odata_q "_solutionid_value eq ${tmp}")" '{"value":[]}' \
        | js "d.value.filter(c=>!(c.componenttype===66 && '${CTL_ID}' && c.objectid.toLowerCase()==='${CTL_ID}'.toLowerCase())).length")
      [[ "$foreign" == 0 ]] || die "${TEMP_SOLUTION} (the temporary solution pac pcf push imports through) already exists with ${foreign} other component(s), probably from another demo. Not touching it. Use --pcf import after 'dataverse/scripts/solution.sh clone' (SOLUTION=${SOLUTION}), or add the control in the maker portal."
      ok "${TEMP_SOLUTION} holds only this control"
    else
      ok "${TEMP_SOLUTION} does not exist; pac pcf push will create it (it then holds only this control)"
    fi
    # = dataverse/scripts/solution.sh push, plus --solution-unique-name so the control lands in our solution.
    (cd "${REPO_ROOT}/pcf/CollectionsBridge" && run pac pcf push --publisher-prefix "$PREFIX" --solution-unique-name "$SOLUTION")
    PCF_STATUS="pushed into ${SOLUTION} (via ${TEMP_SOLUTION})"
  else
    proj="${REPO_ROOT}/dataverse/solution/${SOLUTION}"
    if ! compgen -G "${proj}/*.cdsproj" >/dev/null; then
      if [[ "$DRY_RUN" == 1 ]]; then warn "${proj} does not exist yet; a live --pcf import needs: SOLUTION=${SOLUTION} dataverse/scripts/solution.sh clone"
      else die "--pcf import needs the solution project: SOLUTION=${SOLUTION} dataverse/scripts/solution.sh clone (after app-builder has built the app)."; fi
    fi
    (cd "$REPO_ROOT" && run env SOLUTION="$SOLUTION" PUBLISHER_PREFIX="$PREFIX" dataverse/scripts/solution.sh build)
    zip=$(ls -1 "${proj}"/bin/Release/*.zip 2>/dev/null | head -1 || true)
    [[ -n "$zip" || "$DRY_RUN" == 1 ]] || die "No solution zip under ${proj}/bin/Release."
    # Not solution.sh import: its --publish-changes publishes every unpublished customisation in the environment.
    run pac solution import --path "${zip:-${proj}/bin/Release/${SOLUTION}.zip}"
    PCF_STATUS="imported with ${SOLUTION} (unmanaged)"
  fi
fi

cat >&2 <<EOF

${_B}Summary${_N}
  Environment  ${DATAVERSE_URL}
  Publisher    ${PUB_UNIQUE} (${PUB_FRIENDLY}), prefix ${PREFIX}, id ${PUB_ID}
  Solution     ${SOLUTION} (${SOL_ID})
  Tables       ${TABLES_STATUS}
  PCF          ${PCF_STATUS}

The app-builder App Spec must use: solution uniqueName "${SOLUTION}", publisher "${PUB_UNIQUE}", prefix "${PREFIX}".
Next: build the app with app-builder (tables, views, forms, app, sitemap) into ${SOLUTION}, put the CollectionsBridge
control on the customer form (dataverse/README.md section 3), then deploy/azure.sh.
EOF
