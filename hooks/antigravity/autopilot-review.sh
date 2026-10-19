#!/bin/bash
# Exact native adapter for the three durable review payload operations.
set -euo pipefail
ADAPTER_ROOT="$(cd "$(dirname "$0")/../.." && pwd -P)"
export ZENSU_PLUGIN_ROOT="$ADAPTER_ROOT"
source "$ADAPTER_ROOT/hooks/lib/zensu-session.sh"
zensu_bind_model_session
BOUND_ROOT="$(zensu_resolve_project_dir)"
source "$ADAPTER_ROOT/hooks/lib/zensu-autopilot-state.sh"
OPERATION="${1:-}"
[ "$#" -ge 1 ] || exit 3
shift
case "$OPERATION" in
  operation-key) [ "$#" -eq 2 ] || exit 3 ;;
  read-payload) [ "$#" -eq 4 ] || exit 3 ;;
  store-payload) [ "$#" -eq 5 ] || exit 3 ;;
  *) echo 'Use operation-key, read-payload or store-payload.' >&2; exit 3 ;;
esac
RUN_ID="$1"
_autopilot_identifier_ok "$RUN_ID" || exit 3
_autopilot_read_storage_ready "$BOUND_ROOT" "$RUN_ID"

# Ownership and the operation execute under the SAME canonical project lock.
# A concurrent adoption cannot redirect this call onto its previous owner's run.
_native_autopilot_review_locked() {
  local state
  state="$(_autopilot_read_active_critical "$BOUND_ROOT" "$ZENSU_SESSION_KEY")" || return $?
  printf '%s' "$state" | EXPECTED_RUN="$RUN_ID" EXPECTED_OWNER="$ZENSU_SESSION_KEY" node -e '
    const value=JSON.parse(require("fs").readFileSync(0,"utf8"));
    if(value.runId!==process.env.EXPECTED_RUN || value.ownerSessionId!==process.env.EXPECTED_OWNER
      || ["DONE","CANCELLED"].includes(value.stage)) process.exit(4);
  ' || return 4
  case "$OPERATION" in
    operation-key) autopilot_team_review_operation_key "$1" "$2" ;;
    read-payload)
      _autopilot_read_team_review_payload_critical "$BOUND_ROOT" "$1" "$2" "$3" "$4"
      ;;
    store-payload)
      _autopilot_store_team_review_payload_critical "$BOUND_ROOT" "$1" "$2" "$3" "$4" "$5"
      ;;
  esac
}
_autopilot_locked_run "$BOUND_ROOT" "$RUN_ID" _native_autopilot_review_locked "$@"
