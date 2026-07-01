#!/usr/bin/env bash
# normalize-payload.js — the ONE place that knows Antigravity's stdin envelope.
# It translates an Antigravity hook payload (camelCase, nested toolCall.*) into
# the flat snake_case schema the engine-neutral wrapped scripts read, and
# prints the workspace root on line 1 (the shim exports it as ZENSU_PROJECT_DIR,
# BK6). This pins every mapping in C4 + BK7 (PostToolUse result -> tool_response.*).
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
NP="$ROOT/hooks/antigravity/normalize-payload.js"
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf '  ok   %s\n' "$*"; }
bad() { FAIL=$((FAIL+1)); printf '  FAIL %s\n' "$*"; }

command -v node >/dev/null 2>&1 || { echo "node required"; exit 1; }
[ -f "$NP" ] || { bad "normalize-payload.js missing"; printf 'Result: %d passed, %d failed\n' "$PASS" "$FAIL"; exit 1; }
node --check "$NP" 2>/dev/null && ok "normalize-payload.js passes node --check" || bad "normalize-payload.js syntax error"

# norm <json> -> prints "WS_LINE<NL>PAYLOAD_JSON"; helpers read each.
ws_of()  { printf '%s' "$1" | node "$NP" 2>/dev/null | sed -n '1p'; }
pl_of()  { printf '%s' "$1" | node "$NP" 2>/dev/null | sed -n '2p'; }
field()  { printf '%s' "$1" | node -e 'let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>{try{const j=JSON.parse(s||"{}");const p=process.argv[1].split(".");let v=j;for(const k of p){v=v&&v[k]}process.stdout.write(v===undefined||v===null?"":String(v))}catch(_){}})' "$2"; }

WS="/work/my project"

# 1) shell tool: toolCall.name + args.CommandLine + args.Cwd + workspacePaths[0]
P='{"toolCall":{"name":"run_command","args":{"CommandLine":"npm test","Cwd":"/work/proj/sub"}},"workspacePaths":["'"$WS"'"],"session_id":"abc"}'
PL="$(pl_of "$P")"
[ "$(field "$PL" tool_name)" = "run_command" ] && ok "toolCall.name -> tool_name" || bad "tool_name wrong: $(field "$PL" tool_name)"
[ "$(field "$PL" tool_input.command)" = "npm test" ] && ok "args.CommandLine -> tool_input.command" || bad "command wrong: $(field "$PL" tool_input.command)"
[ "$(field "$PL" cwd)" = "/work/proj/sub" ] && ok "args.Cwd -> cwd (command cwd, distinct from workspace)" || bad "cwd wrong: $(field "$PL" cwd)"
[ "$(field "$PL" session_id)" = "abc" ] && ok "session_id passthrough" || bad "session_id wrong"
[ "$(ws_of "$P")" = "$WS" ] && ok "workspacePaths[0] -> line 1 (workspace root) [BK6]" || bad "workspace root wrong: '$(ws_of "$P")'"

# 2) writer tool: toolCall.args.TargetFile -> tool_input.file_path
P='{"toolCall":{"name":"write_to_file","args":{"TargetFile":"/work/proj/src/app.ts"}},"workspacePaths":["'"$WS"'"]}'
PL="$(pl_of "$P")"
[ "$(field "$PL" tool_name)" = "write_to_file" ] && ok "writer tool_name -> write_to_file" || bad "writer tool_name wrong"
[ "$(field "$PL" tool_input.file_path)" = "/work/proj/src/app.ts" ] && ok "args.TargetFile -> tool_input.file_path" || bad "file_path wrong: $(field "$PL" tool_input.file_path)"

# 2b) writer path probes alternate keys (AbsolutePath / FilePath)
P='{"toolCall":{"name":"replace_file_content","args":{"AbsolutePath":"/x/y.ts"}}}'
[ "$(field "$(pl_of "$P")" tool_input.file_path)" = "/x/y.ts" ] && ok "args.AbsolutePath -> tool_input.file_path (probe)" || bad "AbsolutePath probe failed"

# 3) PostToolUse result -> tool_response.{stdout,exit_code,interrupted} (BK7)
P='{"toolCall":{"name":"run_command","args":{"CommandLine":"go test"}},"toolResponse":{"stdout":"ok pkg/foo","exit_code":0,"interrupted":false},"workspacePaths":["'"$WS"'"]}'
PL="$(pl_of "$P")"
[ "$(field "$PL" tool_response.stdout)" = "ok pkg/foo" ] && ok "toolResponse.stdout -> tool_response.stdout [BK7]" || bad "tool_response.stdout wrong: $(field "$PL" tool_response.stdout)"
[ "$(field "$PL" tool_response.exit_code)" = "0" ] && ok "toolResponse.exit_code -> tool_response.exit_code" || bad "exit_code wrong: $(field "$PL" tool_response.exit_code)"

# 3b) result stdout probes Output/result keys
P='{"toolResponse":{"Output":"captured text"}}'
[ "$(field "$(pl_of "$P")" tool_response.stdout)" = "captured text" ] && ok "toolResponse.Output -> tool_response.stdout (probe)" || bad "Output probe failed"
P='{"result":{"result":"from result.result"}}'
[ "$(field "$(pl_of "$P")" tool_response.stdout)" = "from result.result" ] && ok "result.result -> tool_response.stdout (probe)" || bad "result.result probe failed"

# 4) PreInvocation prompt probing
P='{"prompt":"add a parser","workspacePaths":["'"$WS"'"]}'
[ "$(field "$(pl_of "$P")" prompt)" = "add a parser" ] && ok "prompt passthrough" || bad "prompt wrong"
P='{"userMessage":"track features"}'
[ "$(field "$(pl_of "$P")" prompt)" = "track features" ] && ok "userMessage -> prompt (probe)" || bad "userMessage probe failed"

# 5) transcript + hook_event_name passthrough
P='{"transcriptPath":"/t/x.jsonl","hookEventName":"PreToolUse"}'
PL="$(pl_of "$P")"
[ "$(field "$PL" transcript_path)" = "/t/x.jsonl" ] && ok "transcriptPath -> transcript_path" || bad "transcript_path wrong"
[ "$(field "$PL" hook_event_name)" = "PreToolUse" ] && ok "hookEventName -> hook_event_name" || bad "hook_event_name wrong"

# 6) fail-open: invalid JSON -> empty workspace line + "{}" payload
OUT="$(printf '%s' 'not json at all' | node "$NP" 2>/dev/null)"
WSL="$(printf '%s\n' "$OUT" | sed -n '1p')"
PLL="$(printf '%s\n' "$OUT" | sed -n '2p')"
[ -z "$WSL" ] && [ "$PLL" = "{}" ] && ok "invalid JSON -> empty workspace line + '{}' (fail-open)" || bad "fail-open wrong (ws='$WSL' pl='$PLL')"

# 7) empty stdin -> fail-open (empty workspace line; payload has only empty
#    fields so wrapped scripts find nothing and no-op — never a hard error)
OUT="$(printf '' | node "$NP" 2>/dev/null)"
WSL="$(printf '%s\n' "$OUT" | sed -n '1p')"
PLL="$(printf '%s\n' "$OUT" | sed -n '2p')"
EMPTY_OK="$(printf '%s' "$PLL" | node -e 'let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>{try{const j=JSON.parse(s||"{}");const cmd=(j.tool_input&&j.tool_input.command)||"";const name=j.tool_name||"";process.stdout.write(!cmd&&!name?"yes":"no")}catch(_){process.stdout.write("no")}})')"
{ [ -z "$WSL" ] && [ "$EMPTY_OK" = "yes" ]; } && ok "empty stdin -> empty workspace line + no command/tool (fail-open)" || bad "empty-stdin fail-open wrong (ws='$WSL' pl='$PLL')"

# 8) the normalized payload is single-line JSON (line 2 only)
P='{"toolCall":{"name":"run_command","args":{"CommandLine":"a\nb"}}}'
LINES="$(printf '%s' "$P" | node "$NP" 2>/dev/null | wc -l | tr -d ' ')"
# 2-line output: ws (line1) + payload (line2). A multiline command must not add lines.
[ "$LINES" -le 2 ] && ok "output is exactly 2 lines even with newline in command (no desync)" || bad "output line count = $LINES (expected <=2)"

printf 'Result: %d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
