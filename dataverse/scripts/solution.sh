#!/usr/bin/env bash
# Solution ALM with the Power Platform CLI (pac). Run from the repository root.
#   Prereqs: pac CLI, .NET SDK, Node 20, and `pac auth create --environment https://yourorg.crm4.dynamics.com`
#
#   dataverse/scripts/solution.sh clone    # first time: pull the solution you built in the maker portal
#   dataverse/scripts/solution.sh sync     # later: pull maker-portal changes into source
#   dataverse/scripts/solution.sh build    # build the PCF + pack the solution zip
#   dataverse/scripts/solution.sh import   # import the zip into the authenticated environment
#   dataverse/scripts/solution.sh push     # dev loop: push just the PCF (pac pcf push)
set -euo pipefail

SOLUTION=${SOLUTION:-ContosoCollections}
PUBLISHER_PREFIX=${PUBLISHER_PREFIX:-ppn}
SOL_DIR="dataverse/solution/${SOLUTION}"
PCF_DIR="pcf/CollectionsBridge"

case "${1:-}" in
  clone)
    mkdir -p dataverse/solution
    (cd dataverse/solution && pac solution clone --name "${SOLUTION}" --processCanvasApps false)
    (cd "${SOL_DIR}" && pac solution add-reference --path "../../../${PCF_DIR}")
    ;;
  init)
    # Empty solution project (if you prefer to start from code instead of clone).
    mkdir -p "${SOL_DIR}"
    (cd "${SOL_DIR}" && pac solution init --publisher-name PowerPlatformNinja --publisher-prefix "${PUBLISHER_PREFIX}" && pac solution add-reference --path "../../../${PCF_DIR}")
    ;;
  sync)
    (cd "${SOL_DIR}" && pac solution sync)
    ;;
  build)
    npm run build:prod -w "${PCF_DIR}"
    (cd "${SOL_DIR}" && dotnet build -c Release)
    ls -1 "${SOL_DIR}"/bin/Release/*.zip
    ;;
  import)
    pac solution import --path "$(ls -1 "${SOL_DIR}"/bin/Release/*.zip | head -1)" --publish-changes --activate-plugins
    ;;
  push)
    (cd "${PCF_DIR}" && pac pcf push --publisher-prefix "${PUBLISHER_PREFIX}")
    ;;
  *)
    sed -n '2,12p' "$0"
    exit 1
    ;;
esac
