#!/usr/bin/env node
// emit-verdict.js — the SOLE home of Antigravity's hook output schema. Given a
// role (deny|context|block) and text, print the top-level verdict JSON that
// Antigravity reads on stdout. The shim owns the exit code (always 0 unless the
// contract is `exit`).
//
// The hook stdout/exit contract is the one [AMBIGUOUS] item quarantined here:
//   - Convention A: {"allow_tool":false,"deny_reason":"..."}
//   - Convention B: {"decision":"deny","reason":"..."}
// Both sources agree the verdict is TOP-LEVEL and the hook exits 0. They differ
// only on the field names. ZENSU_AG_HOOK_CONTRACT picks the dialect:
//   superset (default) -> emit BOTH shapes (a probe; pin to the accepted single
//                         dialect once a live `agy` deny-probe confirms which one
//                         actually blocks — superset is the least-safe default
//                         if a strict parser rejects a foreign verdict key, so it
//                         must be verified before being relied on)
//   allow_tool          -> Convention A only
//   decision | exit     -> Convention B only (exit also flips the shim to rc 2)
//
// ZENSU_AG_STOP_BLOCKS (Stop only): 1 -> emit the block verdict; 0 (default)
// -> emit the directive as advisory allow-context (Stop is advisory until a live
// probe confirms a plugin Stop hook can hard-block).

var role = process.env.ZV_ROLE || "";
var text = process.env.ZV_TEXT || "";
var contract = process.env.ZENSU_AG_HOOK_CONTRACT || "superset";
var stopBlocks = process.env.ZENSU_AG_STOP_BLOCKS === "1";

function denyObj() {
  if (contract === "allow_tool") return { allow_tool: false, deny_reason: text };
  if (contract === "decision" || contract === "exit") return { decision: "deny", reason: text };
  return { allow_tool: false, deny_reason: text, decision: "deny", reason: text };
}

function allowContextObj() {
  // Allow the action AND inject context. The injection field name is
  // host-dependent; emit the CC name plus an alias (extra keys are ignored).
  var o = { decision: "allow", allow_tool: true };
  if (text) { o.additionalContext = text; o.context = text; }
  return o;
}

function blockObj() {
  if (!stopBlocks) return allowContextObj();
  if (contract === "allow_tool") return { allow_tool: false, deny_reason: text };
  if (contract === "decision" || contract === "exit") return { decision: "block", reason: text };
  return { decision: "block", reason: text, allow_tool: false, deny_reason: text };
}

var o;
if (role === "deny") o = denyObj();
else if (role === "block") o = blockObj();
else if (role === "context") o = allowContextObj();
else o = {};

process.stdout.write(JSON.stringify(o));
