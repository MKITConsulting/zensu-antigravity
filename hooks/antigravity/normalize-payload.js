#!/usr/bin/env node
// normalize-payload.js — translate an Antigravity hook payload (camelCase,
// nested `toolCall.*`) into the flat snake_case shape the engine-neutral zensu
// hook scripts read (the Claude Code schema). This is the ONE place that knows
// Antigravity's stdin envelope; every wrapped script stays byte-comparable to CC.
//
// Output (two lines on stdout):
//   line 1: the workspace root (workspacePaths[0]) — the shim exports it as
//           CLAUDE_PROJECT_DIR so project-scoped state has a stable anchor that
//           is NOT the command cwd (the source-write-gate's cross-worktree escape
//           check depends on projectRoot != curdir).
//   line 2: the normalized CC-shape payload as single-line JSON.
//
// Fail-open: any parse error yields an empty workspace line + "{}" so wrapped
// scripts simply find empty fields and no-op (never a hard error).

function readStdin() {
  return new Promise((resolve) => {
    let s = "";
    process.stdin.on("data", (c) => (s += c));
    process.stdin.on("end", () => resolve(s));
    process.stdin.on("error", () => resolve(s));
  });
}

function firstString() {
  for (let i = 0; i < arguments.length; i++) {
    if (typeof arguments[i] === "string" && arguments[i]) return arguments[i];
  }
  return "";
}

(async () => {
  const raw = await readStdin();
  let j = {};
  try {
    j = JSON.parse(raw || "{}");
    if (j === null || typeof j !== "object") j = {};
  } catch (_) {
    process.stdout.write("\n{}");
    return;
  }

  const tc = (j.toolCall && typeof j.toolCall === "object") ? j.toolCall : {};
  const args = (tc.args && typeof tc.args === "object") ? tc.args : {};
  const ti = (j.tool_input && typeof j.tool_input === "object") ? j.tool_input : {};
  const out = {};

  // tool name
  out.tool_name = firstString(tc.name, j.tool_name, j.toolName, args.ToolName);

  // tool_input.command (shell) + tool_input.file_path (writers)
  const toolInput = {};
  const cmd = firstString(args.CommandLine, args.command, ti.command);
  if (cmd) toolInput.command = cmd;
  const fp = firstString(args.TargetFile, args.AbsolutePath, args.FilePath, args.file_path, ti.file_path);
  if (fp) toolInput.file_path = fp;
  out.tool_input = toolInput;

  // command cwd (DISTINCT from the workspace root / project dir)
  const ccwd = firstString(args.Cwd, args.cwd, j.cwd);
  if (ccwd) out.cwd = ccwd;

  // tool_response (PostToolUse result) — witness reads exit_code/stdout/interrupted
  const tr = (j.toolResponse && typeof j.toolResponse === "object") ? j.toolResponse
    : (j.tool_response && typeof j.tool_response === "object") ? j.tool_response
    : (j.result && typeof j.result === "object") ? j.result
    : {};
  const resp = {};
  const ec = [tr.exit_code, tr.exitCode, tr.ExitCode, tr.code].find((v) => typeof v === "number");
  if (typeof ec === "number") resp.exit_code = ec;
  const so = firstString(tr.stdout, tr.Output, tr.output, tr.result, (typeof tr === "string" ? tr : ""));
  if (so) resp.stdout = so;
  if (tr.interrupted === true || j.interrupted === true) resp.interrupted = true;
  if (Object.keys(resp).length) out.tool_response = resp;

  // session id + transcript
  out.session_id = firstString(j.session_id, j.sessionId);
  const tp = firstString(j.transcript_path, j.transcriptPath);
  if (tp) out.transcript_path = tp;

  // user prompt (PreInvocation) — field name is host-version-dependent; probe
  // the plausible keys. Absent prompt -> the advisory hooks self-no-op.
  const prompt = firstString(
    j.prompt, j.userMessage, j.user_message, j.message, j.ephemeralMessage,
    j.text, (j.input && j.input.text)
  );
  if (prompt) out.prompt = prompt;

  // agent identity (spawned-subagent detection for the Stop guard)
  const aid = firstString(j.agent_id, j.agentId);
  if (aid) out.agent_id = aid;
  const at = firstString(j.agent_type, j.agentType);
  if (at) out.agent_type = at;

  // hook event name
  const hev = firstString(j.hook_event_name, j.hookEventName);
  if (hev) out.hook_event_name = hev;

  // workspace root (line 1)
  let ws = "";
  if (Array.isArray(j.workspacePaths) && typeof j.workspacePaths[0] === "string") ws = j.workspacePaths[0];
  else if (Array.isArray(j.workspace_paths) && typeof j.workspace_paths[0] === "string") ws = j.workspace_paths[0];
  else if (typeof j.workspaceRoot === "string") ws = j.workspaceRoot;

  process.stdout.write(ws + "\n" + JSON.stringify(out));
})();
