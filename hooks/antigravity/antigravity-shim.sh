#!/bin/bash
# antigravity-shim.sh — the single engine-translation layer between Antigravity
# hooks and the engine-neutral zensu hook scripts. hooks.json registers every
# hook as `bash <ZENSU_HOME>/hooks/antigravity/antigravity-shim.sh <script>.sh <Event>`;
# the wrapped scripts read a flat, normalized payload and stay engine-neutral.
#
# Pipeline: normalize native payload, establish the private immutable binding,
# dispatch the registered engine inventory, preserve the strongest decision,
# render host-specific instructions, and emit the event-specific verdict.
# A trusted first registration also dispatches supported SessionStart behavior.
#
# Optional ZENSU_SHIM_TRACE records event/script/outcome; ZENSU_SHIM_DECISIONS
# records decisions plus safe input digests. Neither writes raw tool content.
# Registered PreToolUse/Stop chains fail closed on unavailable required runtime
# pieces. Isolated standalone transport diagnostics retain empty-verdict fallback.
# Complete canonical denials survive nonzero script exits.
set -u

SHIM_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SHIM_DIR/../.." && pwd)"
export ZENSU_PLUGIN_ROOT="$ROOT"
export ANTIGRAVITY_PLUGIN_ROOT="$ROOT"

# Standalone diagnostic exits preserve native permission handling. PreToolUse
# requires an explicit decision even without Node; {} is a native denial.
# Registered enforcement chains retain their explicit fail-closed paths below.
HOOK_EVENT="${2:-}"
bail() {
  if [ "$HOOK_EVENT" = PreToolUse ]; then printf '%s\n' '{"decision":"ask"}'; else printf '{}\n'; fi
  exit 0
}

# Read-only inventory is shared by registration tests and the live catalog.
select_scripts() {
  SCRIPTS=()
  local selected name
  selected="$(node - "$ROOT/hooks/hooks.json" "$1" "$2" <<'NODE'
const fs=require('fs');
const entry=process.argv[3],tool=process.argv[4];
const event={ 'pre-tool-chain.sh':'PreToolUse','post-tool-chain.sh':'PostToolUse',
  'pre-invocation-chain.sh':'UserPromptSubmit','stop-chain.sh':'Stop','startup-chain.sh':'SessionStart' }[entry];
if(!event){ process.stdout.write(entry+'\n');process.exit(0); }
const inventory=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const groups=inventory.hooks&&inventory.hooks[event];
if(!Array.isArray(groups)||!groups.length)throw Error('Missing engine chain inventory');
for(const group of groups){
  if(group.matcher&&!(new RegExp('^(?:'+group.matcher+')$')).test(tool))continue;
  if(!Array.isArray(group.hooks))throw Error('Invalid engine chain inventory');
  for(const hook of group.hooks){
    const match=typeof hook.command==='string'&&hook.command.match(/^bash "\$\{ZENSU_PLUGIN_ROOT\}\/hooks\/([A-Za-z0-9._-]+\.sh)"$/);
    if(!match)throw Error('Invalid engine chain command');
    process.stdout.write(match[1]+'\n');
  }
}
NODE
)" || return 1
  while IFS= read -r name; do [ -n "$name" ] && SCRIPTS+=("$name"); done <<< "$selected"
  [ "${#SCRIPTS[@]}" -gt 0 ]
}
if [ "${1:-}" = --list-handlers ]; then
  select_scripts "${2:-}" "${3:-}" || exit 1
  printf '%s\n' "${SCRIPTS[@]}"
  exit 0
fi

SCRIPT_NAME="${1:-}"
[ -z "$SCRIPT_NAME" ] && bail
# $1 must be a BARE script name (hooks.json renders bare names; a path here means
# a mis-rendered template — fail-open rather than resolve outside hooks/).
case "$SCRIPT_NAME" in */*) bail ;; esac
# $2 is the hook EVENT this registration sits under. The verdict schema is
# per-event, not per-role (see emit-verdict.js), and the event is a property of
# the WIRING, not of the script — the same script could legitimately be wired to
# a different event. hooks.json.template declares it explicitly rather than
# letting the shim guess from the script name. An absent/unknown event makes
# emit-verdict fail safe (emit {}), so an old two-token registration degrades to
# "hook runs, says nothing" instead of emitting a wrong-shaped verdict.
HOOK_EVENT="${2:-}"
case "$HOOK_EVENT" in
  PreToolUse|PostToolUse|PreInvocation|PostInvocation|Stop) ;;
  *) HOOK_EVENT="" ;;
esac

# --- 1b. firing trace (opt-in; entirely inert unless ZENSU_SHIM_TRACE is set) ---
# The live suite's only way to observe WHICH hooks the host actually invoked. It
# lives in the SHIPPED shim deliberately: the alternative was hand-instrumenting
# the installed copy before each run, which proves a modified artifact fires
# rather than the one users run.
#
# Each line is "<event> <script> <outcome>", written ONCE at the point the outcome
# is known. Recording only the invocation (before the bails) and only the
# execution (after them) are both wrong, in opposite directions: the first reports
# a hook as fired when a dropped script meant nothing ran, the second reports a
# packaging defect as "the host never called us". The outcome field separates the
# two, so a consumer can require `ran` and still SEE the bails.
#
# The `2>/dev/null` MUST precede the append: redirections are applied left to
# right, so with the order reversed a bad trace path prints a shell error to the
# host's stderr on every single hook invocation (verified on bash 3.2).
# Anything under /dev/ is refused, as is an existing non-regular file:
# ZENSU_SHIM_TRACE=/dev/stdout would prepend the trace line to the verdict stream
# and break the host's JSON parse — the one way this debug aid could change a
# verdict. A `-c` test alone does NOT catch it, because with stdout redirected to
# a file /dev/stdout is a symlink to that file rather than a character device.
trace() {
  case "${ZENSU_SHIM_TRACE:-}" in
    ''|/dev/*) return 0 ;;
  esac
  [ -e "$ZENSU_SHIM_TRACE" ] && [ ! -f "$ZENSU_SHIM_TRACE" ] && return 0
  printf '%s %s %s\n' "${HOOK_EVENT:-unknown}" "$SCRIPT_NAME" "$1" 2>/dev/null >>"$ZENSU_SHIM_TRACE" || true
  return 0
}

# Chain names are transport entry points, not additional registered handlers.
# agy 1.1.10 invokes only one PreToolUse handler per matched call, so dispatch
# every neutral gate here rather than relying on the host to compose them.
case "$SCRIPT_NAME" in
  pre-tool-chain.sh|post-tool-chain.sh|pre-invocation-chain.sh|stop-chain.sh) ;;
  *) [ -f "$ROOT/hooks/$SCRIPT_NAME" ] || { trace bail-missing-script; bail; } ;;
esac
if ! command -v node >/dev/null 2>&1; then
  trace bail-no-node
  case "$SCRIPT_NAME:$HOOK_EVENT" in
    pre-tool-chain.sh:PreToolUse) printf '%s\n' '{"decision":"deny","reason":"zensu: Node.js is unavailable, so the tool gates cannot run."}'; exit 0 ;;
    stop-chain.sh:Stop) printf '%s\n' '{"decision":"continue","reason":"zensu: Node.js is unavailable, so workflow completion cannot be verified."}'; exit 0 ;;
  esac
  bail
fi

RAW="$(cat 2>/dev/null || true)"
NORM="$(printf '%s' "$RAW" | node "$SHIM_DIR/normalize-payload.js" "$HOOK_EVENT" 2>/dev/null || true)"
WS_ROOT="$(printf '%s\n' "$NORM" | sed -n '1p')"
PAYLOAD="$(printf '%s\n' "$NORM" | sed -n '2p')"
[ -z "$PAYLOAD" ] && PAYLOAD="$RAW"
if [ -n "$WS_ROOT" ] && [ -d "$WS_ROOT" ]; then
  export ZENSU_PROJECT_DIR="$WS_ROOT"
fi
TOOL="$(printf '%s' "$PAYLOAD" | node -e 'let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>{try{process.stdout.write(String(JSON.parse(s).tool_name||""))}catch(_){}})' 2>/dev/null)"

# Optional decision receipts contain hashes, never command text, file content,
# credentials, or full reasons. The independent firing trace retains its exact
# three-column format. Both paths are operator opt-ins and never affect verdicts.
trace_decision() {
  case "${ZENSU_SHIM_DECISIONS:-}" in ''|/dev/*) return 0 ;; esac
  [ -e "$ZENSU_SHIM_DECISIONS" ] && [ ! -f "$ZENSU_SHIM_DECISIONS" ] && return 0
  printf '%s' "$PAYLOAD" | ZV_SCRIPT="$SCRIPT_NAME" ZV_EVENT="$HOOK_EVENT" ZV_KIND="$KIND" node -e '
    const fs=require("fs"),crypto=require("crypto");
    let j;try{j=JSON.parse(fs.readFileSync(0,"utf8"))}catch(_){process.exit(0)}
    const ti=j.tool_input||{},hash=s=>crypto.createHash("sha256").update(String(s||"")).digest("hex");
    const content=typeof ti.content==="string"?ti.content:typeof ti.new_string==="string"?ti.new_string:"";
    const row={event:process.env.ZV_EVENT,script:process.env.ZV_SCRIPT,decision:process.env.ZV_KIND,
      sessionId:String(j.host_session_id||j.session_id||""),parentSessionId:j.agent_id?String(j.session_id||""):undefined,agentId:j.agent_id,agentType:j.agent_type,terminationReason:j.termination_reason,fullyIdle:j.fully_idle,tool:String(j.tool_name||""),target:String(ti.file_path||ti.notebook_path||""),
      commandDigest:hash(ti.command),contentDigest:hash(content)};
    process.stdout.write(JSON.stringify(row)+"\n");
  ' 2>/dev/null >>"$ZENSU_SHIM_DECISIONS" || true
  return 0
}

classify() {
  # Read from stdin rather than the environment: writer payloads can exceed the
  # process argument limit. Complete decision JSON survives a nonzero child exit;
  # unparseable partial output is raw.
  VERDICT="$(printf '%s' "$OUT" | ZV_RC="$SCRIPT_RC" node -e '
    const fs=require("fs");let kind="raw",text="";
    try{
      const j=JSON.parse(fs.readFileSync(0,"utf8")),h=j&&j.hookSpecificOutput;
      if(h&&["deny","ask","force_ask"].includes(h.permissionDecision)){
        kind=h.permissionDecision;text=h.permissionDecisionReason||"zensu hook requires a decision.";
      }else if(j&&j.decision==="block"){
        kind="block";text=j.reason||"zensu blocked stopping.";
      }else if(h&&typeof h.additionalContext==="string"&&h.additionalContext){
        kind="context";text=h.additionalContext;
      }
    }catch(_){}
    process.stdout.write(kind+"\n"+text);
  ' 2>/dev/null || printf 'raw\n')"
  KIND="$(printf '%s\n' "$VERDICT" | sed -n '1p')"
  TEXT="$(printf '%s\n' "$VERDICT" | sed -n '2,$p')"
  if [ "$KIND" = raw ] && [ "$SCRIPT_RC" = 2 ] && [ "$HOOK_EVENT" = PreToolUse ] && [ "${ENTRY_NAME:-}" = pre-tool-chain.sh ]; then
    KIND=deny
    TEXT="zensu: $SCRIPT_NAME refused this call because its session or plugin context could not be verified. ${ERR:-}"
  fi
  if [ -n "$TEXT" ] && [ -f "$SHIM_DIR/render-context.js" ]; then
    RENDERED="$(printf '%s' "$PAYLOAD" | ZV_TEXT="$TEXT" ZV_SCRIPT="$SCRIPT_NAME" node -e '
      const fs=require("fs");let payload;try{payload=JSON.parse(fs.readFileSync(0,"utf8"))}catch(_){payload={}}
      process.stdout.write(JSON.stringify({text:process.env.ZV_TEXT,script:process.env.ZV_SCRIPT,payload}));
    ' | node "$SHIM_DIR/render-context.js" 2>/dev/null)"
    [ -n "$RENDERED" ] && TEXT="$RENDERED"
  fi
}

emit() { ZV_EVENT="$HOOK_EVENT" ZV_ROLE="$1" ZV_TEXT="$2" node "$SHIM_DIR/emit-verdict.js" 2>/dev/null; }

# A native child has a distinct host UUID but shares its verified parent's
# canonical workflow. Unresolved first invocations cannot mint a main baseline.
NATIVE_STATUS=legacy
NATIVE_LAUNCH=0
NATIVE_VARIANTS=""
NATIVE_FLAG="$(printf '%s' "$PAYLOAD" | node -e 'try{process.stdout.write(JSON.parse(require("fs").readFileSync(0,"utf8")).native_payload===true?"true":"false")}catch(_){}')"
if [ "$NATIVE_FLAG" = true ]; then
  if [ ! -f "$SHIM_DIR/native-agent-provenance.js" ] || [ ! -f "$SHIM_DIR/native-agent-lifecycle.js" ]; then
    case "$HOOK_EVENT" in PreToolUse) emit deny "zensu: native principal verification is unavailable.";; Stop) emit block "zensu: native completion verification is unavailable.";; *) emit "" "";; esac
    echo; exit 0
  fi
  NATIVE_PREPARED="$(printf '%s' "$PAYLOAD" | node "$SHIM_DIR/native-agent-provenance.js" --prepare "$HOOK_EVENT" 2>/dev/null)"
  NATIVE_STATUS="$(printf '%s' "$NATIVE_PREPARED" | node -e 'try{process.stdout.write(JSON.parse(require("fs").readFileSync(0,"utf8")).status||"deny")}catch(_){process.stdout.write("deny")}')"
  NATIVE_REASON="$(printf '%s' "$NATIVE_PREPARED" | node -e 'try{process.stdout.write(JSON.parse(require("fs").readFileSync(0,"utf8")).reason||"Native principal verification is pending.")}catch(_){process.stdout.write("Native principal verification failed.")}')"
  case "$NATIVE_STATUS" in
    main|child)
      PAYLOAD="$(printf '%s' "$NATIVE_PREPARED" | node -e 'process.stdout.write(JSON.stringify(JSON.parse(require("fs").readFileSync(0,"utf8")).payload))')"
      TOOL="$(printf '%s' "$PAYLOAD" | node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(0,"utf8")).tool_name||"")')" ;;
    *)
      case "$HOOK_EVENT" in PreToolUse) emit deny "$NATIVE_REASON";; Stop) emit block "$NATIVE_REASON";; *) emit "" "";; esac
      echo; exit 0 ;;
  esac
  if [ "$NATIVE_STATUS" = child ]; then
    SCRIPT_NAME=native-agent-lifecycle.js
    trace ran
    NATIVE_CHILD="$(printf '%s' "$PAYLOAD" | node "$SHIM_DIR/native-agent-lifecycle.js" --bind-child 2>/dev/null)"; NATIVE_RC=$?
    if [ "$NATIVE_RC" -ne 0 ]; then
      NATIVE_REASON="$(printf '%s' "$NATIVE_CHILD" | node -e 'try{process.stdout.write(JSON.parse(require("fs").readFileSync(0,"utf8")).reason||"Child lease binding failed.")}catch(_){process.stdout.write("Child lease binding failed.")}')"
      case "$HOOK_EVENT" in PreToolUse) emit deny "$NATIVE_REASON";; Stop) emit block "$NATIVE_REASON";; PreInvocation) emit context "$NATIVE_REASON";; *) emit "" "";; esac
      echo; exit 0
    fi
    case "$HOOK_EVENT" in
      Stop)
        NATIVE_CHILD="$(printf '%s' "$PAYLOAD" | node "$SHIM_DIR/native-agent-lifecycle.js" --stop-child 2>/dev/null)"; NATIVE_RC=$?
        KIND="$(printf '%s' "$NATIVE_CHILD" | node -e 'try{const j=JSON.parse(require("fs").readFileSync(0,"utf8"));process.stdout.write(j.decision==="continue"||j.status==="deny"?"block":"raw")}catch(_){process.stdout.write("block")}')"
        [ "$NATIVE_RC" -ne 0 ] && KIND=block
        TEXT="$(printf '%s' "$NATIVE_CHILD" | node -e 'try{process.stdout.write(JSON.parse(require("fs").readFileSync(0,"utf8")).reason||"")}catch(_){}')"
        trace_decision
        emit "$KIND" "${TEXT:-Native child completion could not be verified.}"; echo; exit 0 ;;
      PreInvocation)
        NATIVE_READ_ONLY="$(printf '%s' "$NATIVE_PREPARED" | node -e 'try{process.stdout.write(JSON.parse(require("fs").readFileSync(0,"utf8")).provenance?.readOnlyProfile===true?"true":"false")}catch(_){process.stdout.write("false")}')"
        if [ "$NATIVE_READ_ONLY" = true ]; then
          emit context "You are a verified read-only child. Use only the permitted evidence reads, and return the requested final report as ordinary response text. Do not run state helpers, dispatch agents, mutate files or use task-management tools."
        else
          emit context "You are a verified child with the bounded host profile. Your own tool calls remain subject to the canonical capability and workflow gates. Main-session state helpers and nested native agent dispatch are unavailable; return your result to your parent as ordinary response text."
        fi
        echo; exit 0 ;;
      PostInvocation|PostToolUse) emit "" ""; echo; exit 0 ;;
    esac
  elif [ "$HOOK_EVENT" = PreToolUse ]; then
    NATIVE_VARIANTS="$(printf '%s' "$PAYLOAD" | node "$SHIM_DIR/native-agent-provenance.js" --inspect-launch 2>/dev/null)"; NATIVE_RC=$?
    if [ "$NATIVE_RC" -ne 0 ]; then emit deny "zensu: native review dispatch arguments could not be verified."; echo; exit 0; fi
    NATIVE_COUNT="$(printf '%s' "$NATIVE_VARIANTS" | node -e 'try{const j=JSON.parse(require("fs").readFileSync(0,"utf8"));process.stdout.write(Array.isArray(j)?String(j.length):"0")}catch(_){process.stdout.write("0")}')"
    if [ "$NATIVE_COUNT" -gt 0 ]; then
      NATIVE_LAUNCH=1
      NATIVE_VARIANTS="$(printf '%s' "$NATIVE_VARIANTS" | node -e 'for(const j of JSON.parse(require("fs").readFileSync(0,"utf8")))process.stdout.write(JSON.stringify(j.canonicalPayload)+"\n")')"
      TOOL=Agent
    fi
  fi
  SCRIPT_NAME="${1:-}"
fi

# Bootstrap establishes the canonical private session context before neutral
# gates inspect it. Keep the older lazy initializer only for isolated shim tests
# and old installations that do not carry the bootstrap adapter yet.
BOOT_CONTEXT=""; BOOT_CREATED=false
if [ "$NATIVE_STATUS" = child ]; then
  DATA_ROOT="$(node "$SHIM_DIR/session-bootstrap.js" --data-root 2>/dev/null)"
  [ -n "$DATA_ROOT" ] && export ZENSU_PLUGIN_DATA="$DATA_ROOT"
elif [ -f "$SHIM_DIR/session-bootstrap.js" ]; then
  DATA_ROOT="$(node "$SHIM_DIR/session-bootstrap.js" --data-root 2>/dev/null)"
  [ -n "$DATA_ROOT" ] && export ZENSU_PLUGIN_DATA="$DATA_ROOT"
  OUT="$(printf '%s' "$PAYLOAD" | node "$SHIM_DIR/session-bootstrap.js" --event "$HOOK_EVENT" 2>/dev/null)"; SCRIPT_RC=$?
  BOOT_CREATED="$(printf '%s' "$OUT" | node -e 'try{process.stdout.write(JSON.parse(require("fs").readFileSync(0,"utf8")).zensuBootstrap?.created===true?"true":"false")}catch(_){process.stdout.write("false")}' 2>/dev/null)"
  classify
  [ "$KIND" = context ] && BOOT_CONTEXT="$TEXT"
  if [ "$KIND" = deny ] && [ "$HOOK_EVENT" = PreToolUse ]; then emit deny "$TEXT"; echo; exit 0; fi
  if [ "$KIND" = block ] && [ "$HOOK_EVENT" = Stop ]; then emit block "$TEXT"; echo; exit 0; fi
else
  # Direct script calls are retained for isolated transport diagnostics. A
  # production chain without its session adapter must not silently skip binding.
  case "$SCRIPT_NAME" in
    pre-tool-chain.sh) emit deny "zensu: session bootstrap adapter is missing."; echo; exit 0 ;;
    stop-chain.sh) emit block "zensu: session bootstrap adapter is missing."; echo; exit 0 ;;
  esac
fi

# Only this trusted adapter creates the neutral reviewer outcome. The normalizer
# drops caller-authored fields; native errors are never synthesized as Agent rows.
if [ "$NATIVE_STATUS" = main ] && [ "$HOOK_EVENT" = Stop ]; then
  NATIVE_OUTCOME="$(printf '%s' "$PAYLOAD" | node "$SHIM_DIR/native-reviewer-outcome.js" --bounded-payload 2>/dev/null)"
  if [ -n "$NATIVE_OUTCOME" ]; then
    PAYLOAD="$NATIVE_OUTCOME"
  else
    PAYLOAD="$(printf '%s' "$PAYLOAD" | node -e 'const fs=require("fs"),p=JSON.parse(fs.readFileSync(0,"utf8"));p.reviewer_spawn_probe="status=unreadable kind= tool=reviewer spawns=0 denials=0";process.stdout.write(JSON.stringify(p));')"
  fi
fi

ENTRY_NAME="$SCRIPT_NAME"
if ! select_scripts "$ENTRY_NAME" "$TOOL"; then
  case "$HOOK_EVENT" in
    PreToolUse) emit deny "zensu: the engine gate inventory could not be loaded." ;;
    Stop) emit block "zensu: the Stop gate inventory could not be loaded." ;;
    *) emit "" "" ;;
  esac
  echo; exit 0
fi

# Capture is an advisory backstop after native binding, independent of the
# review chain. Children already exited through their own lifecycle above.
# The adapter's total time budget is bounded and it never blocks Stop.
if [ "$HOOK_EVENT" = Stop ]; then
  printf '%s' "$PAYLOAD" | node "$SHIM_DIR/ai-work.js" checkpoint-hook >&2 || true
fi

NORMAL_SCRIPTS=("${SCRIPTS[@]}")
STARTUP_COUNT=0
if [ "$BOOT_CREATED" = true ]; then
  if select_scripts startup-chain.sh "$TOOL"; then
    STARTUP_COUNT="${#SCRIPTS[@]}"
    SCRIPTS+=("${NORMAL_SCRIPTS[@]}")
  else
    SCRIPTS=("${NORMAL_SCRIPTS[@]}")
  fi
fi

# Per-turn de-bounce for context injection (BK5): PreInvocation fires before
# EVERY model step, so an advisory hook would re-inject the same directive on
# every tool round. Suppress an identical (script,context) pair within the same
# user turn (turn marker = hash of the prompt). New prompt -> new turn -> re-emit.
shim_context_first_this_turn() {
  ZV_CONTEXT_SCRIPT="$1" ZV_CONTEXT_TEXT="$2" ZV_CONTEXT_PAYLOAD="$PAYLOAD" \
    node - "$SHIM_DIR/session-paths.js" "${ZENSU_PLUGIN_DATA:-${ZENSU_PROJECT_DIR:-.}/.zensu/private-advisories}" <<'NODE'
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
try{
  const paths=require(process.argv[2]),payload=JSON.parse(process.env.ZV_CONTEXT_PAYLOAD);
  const sid=paths.safeSessionId(payload.session_id);
  const dir=paths.privateDirectory(process.argv[3],'advisory-turns');
  const file=path.join(dir,hash(sid)+'.json');
  const turn=hash(typeof payload.prompt==='string'?payload.prompt:'');
  const signature=hash(process.env.ZV_CONTEXT_SCRIPT+'\0'+process.env.ZV_CONTEXT_TEXT);
  let record={sessionId:sid,turn,signatures:[]};
  try{
    const previous=paths.readPrivateJson(file,65536);
    if(previous.sessionId===sid&&previous.turn===turn&&Array.isArray(previous.signatures))record=previous;
  }catch(_){}
  if(record.signatures.includes(signature))process.exit(1);
  record.signatures.push(signature);
  record.signatures=record.signatures.slice(-128);
  paths.writePrivateJson(file,record);
}catch(_){}
NODE
}

# If the first observed host event has no advisory channel, keep startup text
# in the private adapter store until PreInvocation. Never use a workspace file
# for this message: repository content cannot become a trusted startup directive.
startup_pending() {
  ZV_PENDING_ACTION="$1" ZV_PENDING_TEXT="${2:-}" ZV_PENDING_SESSION="$(printf '%s' "$PAYLOAD" | node -e 'try{process.stdout.write(JSON.parse(require("fs").readFileSync(0,"utf8")).session_id||"")}catch(_){}')" node - "$ZENSU_PLUGIN_DATA" <<'NODE'
const fs=require('fs'),path=require('path'),crypto=require('crypto');
try{
  const sid=process.env.ZV_PENDING_SESSION;
  if(typeof sid!=='string'||!sid)process.exit(0);
  const dir=path.join(process.argv[2],'startup-pending');
  fs.mkdirSync(dir,{recursive:true,mode:0o700});
  const stat=fs.lstatSync(dir);if(!stat.isDirectory()||stat.isSymbolicLink()||(stat.mode&0o077))process.exit(0);
  const file=path.join(dir,crypto.createHash('sha256').update(sid).digest('hex')+'.json');
  if(process.env.ZV_PENDING_ACTION==='save'){
    fs.writeFileSync(file,JSON.stringify({sessionId:sid,text:process.env.ZV_PENDING_TEXT}),{flag:'wx',mode:0o600});
  }else{
    const st=fs.lstatSync(file);if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1||st.size>262144||(st.mode&0o077))process.exit(0);
    const value=JSON.parse(fs.readFileSync(file,'utf8'));
    if(value.sessionId===sid&&typeof value.text==='string'){fs.unlinkSync(file);process.stdout.write(value.text);}
  }
}catch(_){}
NODE
}

# A hard deny always wins. Ask directives survive later allows/advisories, and
# every remaining gate runs so a later denial can still strengthen the verdict.
FINAL_KIND=""; FINAL_TEXT=""; CONTEXT=""
if [ -n "$BOOT_CONTEXT" ] && shim_context_first_this_turn session-bootstrap.js "$BOOT_CONTEXT"; then CONTEXT="$BOOT_CONTEXT"; fi
GATE_PAYLOAD="$PAYLOAD"
if [ "$HOOK_EVENT" = PreInvocation ] && [ -n "${ZENSU_PLUGIN_DATA:-}" ]; then
  PENDING_CONTEXT="$(startup_pending read)"
  [ -n "$PENDING_CONTEXT" ] && CONTEXT="$PENDING_CONTEXT
$CONTEXT"
fi
STARTUP_CONTEXT=""; SCRIPT_INDEX=0
if [ "$ENTRY_NAME" = pre-tool-chain.sh ] && [ "$TOOL" = Bash ]; then
  SCRIPT_NAME=session-command-guard.js
  if [ ! -f "$SHIM_DIR/$SCRIPT_NAME" ]; then emit deny "zensu: session command guard is missing."; echo; exit 0; fi
  trace ran
  OUT="$(printf '%s' "$PAYLOAD" | node "$SHIM_DIR/$SCRIPT_NAME" --inspect 2>/dev/null)"; SCRIPT_RC=$?
  classify; trace_decision
  if [ "$KIND" = deny ]; then emit deny "$TEXT"; echo; exit 0; fi
  GATE_PAYLOAD="$(printf '%s' "$PAYLOAD" | node "$SHIM_DIR/$SCRIPT_NAME" --gate-payload 2>/dev/null)"; SCRIPT_RC=$?
  if [ "$SCRIPT_RC" -ne 0 ] || [ -z "$GATE_PAYLOAD" ]; then emit deny "zensu: session helper payload could not be verified."; echo; exit 0; fi
fi
GATE_VARIANTS="$GATE_PAYLOAD"
[ "$NATIVE_LAUNCH" -eq 1 ] && GATE_VARIANTS="$NATIVE_VARIANTS"
while IFS= read -r GATE_PAYLOAD; do
SCRIPT_INDEX=0
for SCRIPT_NAME in "${SCRIPTS[@]}"; do
  SCRIPT_INDEX=$((SCRIPT_INDEX+1))
  SCRIPT_PAYLOAD="$GATE_PAYLOAD"
  if [ "$SCRIPT_INDEX" -le "$STARTUP_COUNT" ]; then
    SCRIPT_PAYLOAD="$(printf '%s' "$PAYLOAD" | node -e 'const fs=require("fs");const j=JSON.parse(fs.readFileSync(0,"utf8"));j.hook_event_name="SessionStart";j.source="startup";process.stdout.write(JSON.stringify(j));')"
  fi
  SCRIPT="$ROOT/hooks/$SCRIPT_NAME"
  if [ ! -f "$SCRIPT" ]; then
    trace bail-missing-script
    case "$ENTRY_NAME:$HOOK_EVENT" in
      pre-tool-chain.sh:PreToolUse) FINAL_KIND=deny; FINAL_TEXT="zensu: required gate $SCRIPT_NAME is missing."; break ;;
      stop-chain.sh:Stop) FINAL_KIND=block; FINAL_TEXT="zensu: required Stop gate $SCRIPT_NAME is missing."; break ;;
    esac
    continue
  fi
  trace ran
  CAP_DIR="$(mktemp -d 2>/dev/null)" || continue
  if [ "$SCRIPT_INDEX" -le "$STARTUP_COUNT" ] && [ -d "${ZENSU_PROJECT_DIR:-}" ]; then
    ( cd "$ZENSU_PROJECT_DIR" && printf '%s' "$SCRIPT_PAYLOAD" | bash "$SCRIPT" ) >"$CAP_DIR/out" 2>"$CAP_DIR/err"; SCRIPT_RC=$?
  else
    printf '%s' "$SCRIPT_PAYLOAD" | bash "$SCRIPT" >"$CAP_DIR/out" 2>"$CAP_DIR/err"; SCRIPT_RC=$?
  fi
  OUT="$(cat "$CAP_DIR/out" 2>/dev/null || true)"
  ERR="$(cat "$CAP_DIR/err" 2>/dev/null || true)"
  rm -rf "$CAP_DIR" 2>/dev/null || true
  classify
  if [ "$SCRIPT_INDEX" -le "$STARTUP_COUNT" ] && [ "$SCRIPT_NAME" = session-start-pulse.sh ] && [ "$SCRIPT_RC" = 0 ] && [ -n "$OUT" ]; then KIND=context; TEXT="$OUT"; fi
  trace_decision
  case "$KIND" in
    deny|block) FINAL_KIND="$KIND"; FINAL_TEXT="$TEXT"; break ;;
    force_ask) FINAL_KIND="$KIND"; FINAL_TEXT="$TEXT" ;;
    ask) if [ "$FINAL_KIND" != force_ask ]; then FINAL_KIND=ask; FINAL_TEXT="$TEXT"; fi ;;
    context)
      if [ "$SCRIPT_INDEX" -le "$STARTUP_COUNT" ]; then
        STARTUP_CONTEXT="$STARTUP_CONTEXT
$TEXT"
      fi
      case "$HOOK_EVENT" in
        PreInvocation|PostInvocation)
          if shim_context_first_this_turn "$SCRIPT_NAME" "$TEXT"; then
            [ -n "$CONTEXT" ] && CONTEXT="$CONTEXT

$TEXT" || CONTEXT="$TEXT"
          fi ;;
      esac ;;
    *) [ -n "$ERR" ] && printf '%s\n' "$ERR" >&2 ;;
  esac
done
  case "$FINAL_KIND" in deny|block) break;; esac
  SCRIPTS=("${NORMAL_SCRIPTS[@]}")
  STARTUP_COUNT=0
done <<< "$GATE_VARIANTS"
if [ -n "$STARTUP_CONTEXT" ] && [ "$HOOK_EVENT" != PreInvocation ] && [ "$HOOK_EVENT" != PostInvocation ] && [ -n "${ZENSU_PLUGIN_DATA:-}" ]; then
  startup_pending save "$STARTUP_CONTEXT"
fi
# Mint helper authorization only after the entire gate chain accepted the
# exact original request. Deny and ask paths must leave no reusable receipt.
if [ "$ENTRY_NAME" = pre-tool-chain.sh ] && [ "$TOOL" = Bash ] && [ -z "$FINAL_KIND" ]; then
  SCRIPT_NAME=session-command-guard.js
  OUT="$(printf '%s' "$PAYLOAD" | node "$SHIM_DIR/$SCRIPT_NAME" --authorize 2>/dev/null)"; SCRIPT_RC=$?
  classify
  if [ "$SCRIPT_RC" -ne 0 ] || [ "$KIND" = deny ]; then
    FINAL_KIND=deny
    FINAL_TEXT="${TEXT:-zensu: session helper authorization failed after policy checks.}"
    trace_decision
  fi
fi
if [ "$NATIVE_LAUNCH" -eq 1 ] && [ -z "$FINAL_KIND" ]; then
  SCRIPT_NAME=native-agent-provenance.js
  NATIVE_AUTH="$(printf '%s' "$PAYLOAD" | node "$SHIM_DIR/native-agent-provenance.js" --authorize-launch 2>/dev/null)"; NATIVE_RC=$?
  NATIVE_AUTHORIZED="$(printf '%s' "$NATIVE_AUTH" | node -e 'try{process.stdout.write(JSON.parse(require("fs").readFileSync(0,"utf8")).authorized===true?"true":"false")}catch(_){}')"
  if [ "$NATIVE_RC" -ne 0 ] || [ "$NATIVE_AUTHORIZED" != true ]; then
    FINAL_KIND=deny; FINAL_TEXT="zensu: native review dispatch authorization could not be recorded."
  elif [ -f "$SHIM_DIR/native-spawn-allow.js" ]; then
    SCRIPT_NAME=native-spawn-allow.js
    NATIVE_GRANT="$( { printf '%s\n' "$PAYLOAD"; printf '%s\n' "$NATIVE_AUTH"; } | node -e 'const fs=require("fs"),lines=fs.readFileSync(0,"utf8").trim().split("\n");process.stdout.write(JSON.stringify({payload:JSON.parse(lines[0]),authorization:JSON.parse(lines[1])}));' | node "$SHIM_DIR/native-spawn-allow.js" 2>/dev/null)"
    if [ "$(printf '%s' "$NATIVE_GRANT" | node -e 'try{process.stdout.write(JSON.parse(require("fs").readFileSync(0,"utf8")).allow===true?"true":"false")}catch(_){}')" = true ]; then
      FINAL_KIND=allow; FINAL_TEXT="zensu: the recorded reviewer batch is confined to the audited native read profiles."
      KIND=allow; trace ran; trace_decision
    fi
  fi
fi
if [ -n "$FINAL_KIND" ]; then
  emit "$FINAL_KIND" "$FINAL_TEXT"
elif [ -n "$CONTEXT" ]; then
  emit context "$CONTEXT"
else
  emit "" ""
fi
echo
exit 0
