#!/bin/bash
set -u

# Structure test for the agents/ roster. Complements test-agents-present.sh
# (which pins the original three) by validating the WHOLE directory generically
# plus the review-chain additions:
#   P1 every agents/*.md opens with frontmatter carrying name + description
#   P2 every frontmatter name equals the filename stem and is zensu- prefixed
#   P3 the judge agent is READ-ONLY: a non-empty tools list with no write tool
#      and no run_command, plus its load-bearing chain contract strings
#   P4 the plan/pr review workers are read-only evidence workers
#   P5 no agent file mentions a forbidden host word (the port is standalone —
#      host is Antigravity, binary agy, env prefix ZENSU_)
#
# The forbidden host-word needle is ASSEMBLED AT RUNTIME so this guard file
# itself stays free of the strings it forbids.

PLUGIN_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
AGENTS_DIR="$PLUGIN_DIR/agents"

JUDGE="$AGENTS_DIR/zensu-review-judge.md"
PLAN_WORKER="$AGENTS_DIR/zensu-plan-review-worker.md"
PR_WORKER="$AGENTS_DIR/zensu-pr-review-worker.md"

PASS=0; FAIL=0
check() {
  local label="$1" cond="$2"
  if [ "$cond" = "PASS" ]; then echo "  PASS  $label"; PASS=$((PASS+1));
  else echo "  FAIL  $label"; FAIL=$((FAIL+1)); fi
}

finish() {
  echo "----"
  echo "test-agents-roster: $PASS PASS / $FAIL FAIL"
  [ "$FAIL" -eq 0 ]
}

if [ ! -d "$AGENTS_DIR" ]; then
  check "P0 agents/ directory exists" FAIL
  finish
  exit 1
fi

AGENT_COUNT=0
for f in "$AGENTS_DIR"/*.md; do
  [ -f "$f" ] && AGENT_COUNT=$((AGENT_COUNT+1))
done
if [ "$AGENT_COUNT" -eq 0 ]; then
  check "P0 agents/ contains at least one agent" FAIL
  finish
  exit 1
fi
check "P0 agents/ is non-empty ($AGENT_COUNT agents)" PASS

for f in "$JUDGE" "$PLAN_WORKER" "$PR_WORKER"; do
  if [ -f "$f" ]; then
    check "P0 review-chain agent present: agents/$(basename "$f")" PASS
  else
    check "P0 review-chain agent MISSING: agents/$(basename "$f")" FAIL
  fi
done

# first value of `key:` inside the opening --- block
fm_field() {
  awk -v k="$2" '
    /^---[[:space:]]*$/ { c++; if (c==2) exit; next }
    c==1 && $0 ~ "^"k":" { sub("^"k":[[:space:]]*",""); print; exit }
  ' "$1"
}

# a frontmatter block is valid when line 1 is --- and a closing --- follows
fm_closed() {
  awk '/^---[[:space:]]*$/ { c++ } END { exit (c >= 2 ? 0 : 1) }' "$1"
}

# P1/P2 — generic frontmatter + naming contract over the whole roster
BAD_FM=""; BAD_NAME=""; BAD_PREFIX=""; BAD_DESC=""
for f in "$AGENTS_DIR"/*.md; do
  [ -f "$f" ] || continue
  base="$(basename "$f")"
  stem="${base%.md}"
  head -n 1 "$f" | grep -q '^---[[:space:]]*$' || BAD_FM="$BAD_FM $base"
  fm_closed "$f" || BAD_FM="$BAD_FM $base"
  name="$(fm_field "$f" name)"
  desc="$(fm_field "$f" description)"
  [ -n "$desc" ] || BAD_DESC="$BAD_DESC $base"
  if [ -z "$name" ] || [ "$name" != "$stem" ]; then
    BAD_NAME="$BAD_NAME $base"
  fi
  case "$name" in
    zensu-*) ;;
    *) BAD_PREFIX="$BAD_PREFIX $base" ;;
  esac
done

[ -z "$BAD_FM" ] && check "P1a every agent opens+closes a frontmatter block" PASS \
  || check "P1a agents with broken frontmatter:$BAD_FM" FAIL
[ -z "$BAD_DESC" ] && check "P1b every agent declares a description" PASS \
  || check "P1b agents without description:$BAD_DESC" FAIL
[ -z "$BAD_NAME" ] && check "P2a every frontmatter name equals the filename stem" PASS \
  || check "P2a agents with name/stem mismatch:$BAD_NAME" FAIL
[ -z "$BAD_PREFIX" ] && check "P2b every agent name carries the zensu- prefix" PASS \
  || check "P2b agents without the zensu- prefix:$BAD_PREFIX" FAIL

# P3/P4 — read-only tool contracts
tools_of() { fm_field "$1" tools | tr 'A-Z' 'a-z'; }
WRITE_TOOLS='write_to_file|replace_file_content|multi_replace_file_content|create_file|apply_patch|\bwrite\b|\bedit\b'

readonly_agent() { # $1=file $2=label-prefix
  local f="$1" p="$2" t=""
  if [ ! -f "$f" ]; then
    check "$p file missing" FAIL
    return
  fi
  t="$(tools_of "$f")"
  if [ -n "$t" ]; then
    check "$p declares a non-empty tools list" PASS
  else
    check "$p has no tools: frontmatter" FAIL
  fi
  if printf '%s' "$t" | grep -qE "$WRITE_TOOLS"; then
    check "$p tools list includes a WRITE tool: '$t'" FAIL
  else
    check "$p tools list is WRITE-FREE" PASS
  fi
  if printf '%s' "$t" | grep -q 'run_command'; then
    check "$p must NOT have run_command (zero build/test)" FAIL
  else
    check "$p has no run_command (zero build/test)" PASS
  fi
  if printf '%s' "$t" | grep -qiE 'taskcreate|taskupdate'; then
    check "$p still lists foreign task tools" FAIL
  else
    check "$p carries no foreign task tools" PASS
  fi
}

readonly_agent "$JUDGE" "P3 zensu-review-judge"
readonly_agent "$PLAN_WORKER" "P4a zensu-plan-review-worker"
readonly_agent "$PR_WORKER" "P4b zensu-pr-review-worker"

# P3 — judge chain contract strings (load-bearing for the review chain)
if [ -f "$JUDGE" ]; then
  if grep -qF 'Panel-FP:' "$JUDGE"; then
    check "P3e judge pins the Panel-FP: false-positive prefix" PASS
  else
    check "P3e judge pins the Panel-FP: false-positive prefix" FAIL
  fi
  if grep -qF '## Aspect: judge' "$JUDGE"; then
    check "P3f judge emits the mergeable '## Aspect: judge' header" PASS
  else
    check "P3f judge emits the mergeable '## Aspect: judge' header" FAIL
  fi
  if grep -qF 'JUDGE-' "$JUDGE"; then
    check "P3g judge findings carry the JUDGE- ID prefix" PASS
  else
    check "P3g judge findings carry the JUDGE- ID prefix" FAIL
  fi
  if grep -qiF 'read-only' "$JUDGE" && grep -qF 'merged' "$JUDGE"; then
    check "P3h judge states read-only + post-merge placement" PASS
  else
    check "P3h judge states read-only + post-merge placement" FAIL
  fi
fi

# P5 — standalone guard: no forbidden host word in any agent file.
# Needle assembled at runtime; the search is case-insensitive so every variant
# (bare word, product name, env prefix, dot-directory) is covered.
#
# CARVE-OUT — verbatim EXTERNAL CLI identifiers. The Zensu backend ships
# `zensu doc <needle>-md` / `zensu doc <needle>-md-context` (and their tool
# names in hooks/lib/zensu-cli-map.sh). Those lowercase tokens are the real
# subcommands the agent must type to invoke the CLI — renaming them would break
# the call. They are stripped case-SENSITIVELY before the scan, so any other
# spelling (capitalized, env prefix, dot-directory) still fails the guard.
HOST_NEEDLE="$(printf '%s%s' 'cla' 'ude')"
host_word_hits() { # $1=file -> "line:text" for every non-carved-out occurrence
  sed -e "s/${HOST_NEEDLE}-md-context//g" \
      -e "s/${HOST_NEEDLE}-md//g" \
      -e "s/generate_${HOST_NEEDLE}_md//g" \
      -e "s/get_${HOST_NEEDLE}_md//g" \
      "$1" 2>/dev/null | grep -in "$HOST_NEEDLE"
}
HOST_HITS=""
for f in "$AGENTS_DIR"/*.md; do
  [ -f "$f" ] || continue
  if [ -n "$(host_word_hits "$f")" ]; then
    HOST_HITS="$HOST_HITS $(basename "$f")"
  fi
done
if [ -z "$HOST_HITS" ]; then
  check "P5a no agent mentions the forbidden host word" PASS
else
  check "P5a agents mentioning the forbidden host word:$HOST_HITS" FAIL
fi

# Negative control: the guard must still catch a non-carved-out spelling.
PROBE="$(mktemp -t hostword-XXXXXX)"
printf 'The %s Code host renders this.\n' "$HOST_NEEDLE" > "$PROBE"
if [ -n "$(host_word_hits "$PROBE")" ]; then
  check "P5c the host-word guard catches a non-carved-out spelling" PASS
else
  check "P5c the host-word guard catches a non-carved-out spelling" FAIL
fi
printf 'Run `zensu doc %s-md --product <id>`.\n' "$HOST_NEEDLE" > "$PROBE"
if [ -z "$(host_word_hits "$PROBE")" ]; then
  check "P5d the carve-out admits the verbatim external CLI subcommand" PASS
else
  check "P5d the carve-out admits the verbatim external CLI subcommand" FAIL
fi
rm -f "$PROBE"

# The plugin is MCP-free: agents must not wire a model-context-protocol server.
MCP_HITS="$(grep -rl 'mcpServers' "$AGENTS_DIR" 2>/dev/null)"
if [ -z "$MCP_HITS" ]; then
  check "P5b no agent declares an mcpServers block" PASS
else
  check "P5b agents declaring mcpServers: $(printf '%s ' $MCP_HITS)" FAIL
fi

finish
