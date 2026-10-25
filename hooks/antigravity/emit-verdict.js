#!/usr/bin/env node
'use strict';
// emit-verdict.js — the SOLE home of Antigravity's hook output schema. Given the
// EVENT being served and a role (deny|context|block), print the top-level verdict
// JSON the host reads on stdout. The shim owns the exit code (always 0).
//
// The schema is per-EVENT, not per-role: the same "inject some context" intent is
// a different wire shape on PreToolUse than on PreInvocation. Source of truth:
// the host's own spec, ~/.gemini/antigravity-cli/builtin/skills/agy-customizations/
// docs/hooks.md ("Input/Output Contract"), agy 1.1.10.
//
//   PreToolUse    {"decision":"allow"|"deny"|"ask"|"force_ask","reason":"..."}
//   PostToolUse   {}
//   PreInvocation {"injectSteps":[{"ephemeralMessage":"..."}]}
//   PostInvocation same as PreInvocation, plus optional terminationBehavior
//   Stop          {"decision":"continue","reason":"..."} blocks the stop;
//                 ANY other value lets the agent stop.
//
// Two of those were wrong before this file was rewritten, and both failures were
// silent. The old code emitted a PreToolUse-shaped allow+additionalContext object
// on PreInvocation, so no advisory ever reached the model; and it emitted
// decision:"block" on Stop, which the host reads as "not continue" — i.e. stop
// anyway — so the chain-enforcer could never hold a turn open. Neither produced a
// warning anywhere. Do not reintroduce a role-only shape.
//
// ZV_EVENT selects the dialect. An unknown or missing event is a bug in the shim,
// not in the host: emit {} without claiming an executable tool verdict rather than
// guessing a shape that might deny a tool call or wedge the loop.

function verdict(event, role, text) {

function injectSteps() {
  return text ? { injectSteps: [{ ephemeralMessage: text }] } : {};
}

function preToolUse() {
  if (["deny", "ask", "force_ask", "allow"].includes(role)) {
    return { decision: role, reason: text || "zensu hook requires a decision for this tool call." };
  }
  // The host requires an explicit decision: live control probes showed that
  // {} is treated as a denial with an empty reason. Ask preserves the native
  // permission path and Always Allow cache without auto-approving the tool.
  // Advisory text has no channel on this event and must remain absent.
  return { decision: "ask" };
}

function stop() {
  // "continue" is the ONLY value that blocks stopping. A deny/block role means
  // the chain is not finished, so the loop must re-enter.
  if (role === "block" || role === "deny") {
    return { decision: "continue", reason: text || "zensu: the review chain has not terminated." };
  }
  // Nothing to enforce: say nothing and let the agent stop.
  return {};
}

// An uneventful PreToolUse still needs an explicit native permission decision.
// Other events retain the empty verdict when there is nothing to emit.
if (!role && event !== "PreToolUse") {
  return {};
}

let o;
switch (event) {
  case "PreToolUse":
    o = preToolUse();
    break;
  case "PostToolUse":
    // The host expects an empty object. There is no advisory channel here.
    o = {};
    break;
  case "PreInvocation":
  case "PostInvocation":
    o = injectSteps();
    break;
  case "Stop":
    o = stop();
    break;
  default:
    o = {};
    break;
}

return o;
}

if (require.main === module) {
  process.stdout.write(JSON.stringify(verdict(
    process.env.ZV_EVENT || "", process.env.ZV_ROLE || "", process.env.ZV_TEXT || "",
  )));
}
module.exports = { verdict };
