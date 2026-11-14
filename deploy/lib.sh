# shellcheck shell=bash
# Shared helpers for deploy/*.sh. Source it; don't run it.
#
#   run   CMD...              a change (create/update). Dry-run: printed, not executed.
#   mut   PLACEHOLDER CMD...  a change whose stdout we need. Dry-run: printed, PLACEHOLDER returned.
#   query PLACEHOLDER CMD...  a read that needs the network/tenant. Dry-run: printed, PLACEHOLDER returned.
#   local_probe CMD...        a read of local CLI state only (az account show, pac auth list). Runs in dry-run too.
#
# Everything is traced to stderr so command substitution only captures values.
# Values listed in REDACT_VALUES are masked in traces. Tokens are never traced or printed.

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${DEPLOY_DIR}/.." && pwd)"
PROJECT_TAG_KEY="project"
PROJECT_TAG_VALUE="xrm-copilot-collections"
DRY_RUN=${DRY_RUN:-0}
REDACT_VALUES=()

if [[ -t 2 ]]; then _B=$'\033[1m'; _R=$'\033[31m'; _Y=$'\033[33m'; _G=$'\033[32m'; _D=$'\033[2m'; _N=$'\033[0m'; else _B= _R= _Y= _G= _D= _N=; fi

log()  { printf '%s==>%s %s\n' "$_B" "$_N" "$*" >&2; }
ok()   { printf '%s ok%s %s\n' "$_G" "$_N" "$*" >&2; }
warn() { printf '%swarn%s %s\n' "$_Y" "$_N" "$*" >&2; }
die()  { printf '%sERROR%s %s\n' "$_R" "$_N" "$*" >&2; exit 1; }

_fmt_cmd() {
  local out=() a v
  for a in "$@"; do
    for v in "${REDACT_VALUES[@]+"${REDACT_VALUES[@]}"}"; do [[ -n "$v" ]] && a=${a//"$v"/***}; done
    if [[ "$a" =~ ^[A-Za-z0-9_./:=@,+%-]+$ ]]; then out+=("$a"); else out+=("'${a//\'/\'\\\'\'}'"); fi
  done
  printf '%s' "${out[*]}"
}

run() {
  if [[ "$DRY_RUN" == 1 ]]; then printf '%s[dry-run]%s %s\n' "$_Y" "$_N" "$(_fmt_cmd "$@")" >&2; return 0; fi
  printf '%s+ %s%s\n' "$_D" "$(_fmt_cmd "$@")" "$_N" >&2
  "$@"
}

mut() {
  local placeholder=$1; shift
  if [[ "$DRY_RUN" == 1 ]]; then printf '%s[dry-run]%s %s\n' "$_Y" "$_N" "$(_fmt_cmd "$@")" >&2; printf '%s\n' "$placeholder"; return 0; fi
  printf '%s+ %s%s\n' "$_D" "$(_fmt_cmd "$@")" "$_N" >&2
  "$@"
}

query() {
  local placeholder=$1; shift
  if [[ "$DRY_RUN" == 1 ]]; then printf '%s[dry-run] read:%s %s\n' "$_D" "$_N" "$(_fmt_cmd "$@")" >&2; printf '%s\n' "$placeholder"; return 0; fi
  "$@"
}

local_probe() { "$@" 2>/dev/null; }

need() { command -v "$1" >/dev/null 2>&1 || die "'$1' is not installed or not on PATH. $2"; }

# Reads KEY=VALUE lines from deploy/tenant.env without `source` (values such as
# "CRONUS ES" contain spaces). Variables already set in the environment win.
load_tenant_env() {
  local file=${TENANT_ENV:-${DEPLOY_DIR}/tenant.env} line key value
  [[ -f "$file" ]] || die "Missing ${file}. Copy deploy/tenant.env.example to deploy/tenant.env and fill it in."
  while IFS= read -r line || [[ -n "$line" ]]; do
    line=${line%$'\r'}
    [[ "$line" =~ ^[[:space:]]*# || ! "$line" =~ ^[[:space:]]*([A-Z_][A-Z0-9_]*)=(.*)$ ]] && continue
    key=${BASH_REMATCH[1]}; value=${BASH_REMATCH[2]}
    value=${value%"${value##*[![:space:]]}"}
    if [[ "$value" =~ ^\"(.*)\"$ || "$value" =~ ^\'(.*)\'$ ]]; then value=${BASH_REMATCH[1]}; fi
    [[ -z "${!key:-}" ]] && printf -v "$key" '%s' "$value" && export "${key?}"
  done <"$file"
}

require_vars() {
  local k missing=()
  for k in "$@"; do [[ -n "${!k:-}" ]] || missing+=("$k"); done
  ((${#missing[@]} == 0)) || die "Set ${missing[*]} in deploy/tenant.env."
}

# Bearer header for curl via a process substitution, so the token never appears
# on a command line, in a trace or in a file. Usage: curl -H @<(auth_header "$TOKEN") ...
auth_header() { printf 'Authorization: Bearer %s\n' "$1"; }

# Temp dir for request bodies (never secrets), removed on exit.
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT
