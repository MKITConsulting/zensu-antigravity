"use strict";

// Decision logic for the secret scan, shared by pre-write-secret-scan.sh (the
// file writers) and the raw-Bash step of pre-bash-source-write-gate.sh. Kept in
// its own file (like bash-source-write-parse.js) so it uses normal quoting
// instead of a bash single-quoted node -e, and so pathExempt is unit-testable.
// Reads the normalized PreToolUse payload from STDIN (not env — a ~1MB write
// via env risks E2BIG and would fail open exactly on the largest payloads).
// Prints the matched rule names on stdout, or nothing. Fail-open paths note
// themselves on stderr and exit 0.
//
// Tool dispatch (Antigravity tool names; the shim hands over the flat payload):
//   write_to_file              — scan tool_input.content
//   replace_file_content       — scan tool_input.content
//   multi_replace_file_content — scan tool_input.content
//     (all three: path allowlist on tool_input.file_path)
//   run_command                — scan the command text when the shared parser
//                                reports a write channel (detectChannels); an
//                                inline ZENSU_SECRET_SCAN=off prefix skips the
//                                scan (parity with the sibling gates' inline
//                                escape hatches; checked against heredoc-
//                                STRIPPED text so a scanned payload cannot
//                                smuggle the escape inside a heredoc body). The
//                                path allowlist does NOT apply to run_command —
//                                targets are not resolved here; use the marker,
//                                a placeholder, or the escape hatch instead.
//
// pathExempt covers test(s)/, __tests__/, spec(s)/, testdata/, evals/,
// fixtures/ segments (case-insensitive) and *.example.* files.

const path = require("path");
const { scan } = require(path.join(__dirname, "secret-patterns.js"));
const { detectChannels, stripHeredocs } = require(path.join(__dirname, "bash-source-write-parse.js"));

const WRITERS = new Set(["write_to_file", "replace_file_content", "multi_replace_file_content"]);

function pathExempt(p) {
  if (typeof p !== "string" || !p) return false;
  const norm = p.replace(/\\/g, "/");
  if (/(^|\/)(__tests__|tests?|specs?|testdata|evals|fixtures)\//i.test(norm)) return true;
  if (/\.example\./.test(path.basename(norm))) return true;
  return false;
}

function main() {
  let raw = "";
  try {
    raw = require("fs").readFileSync(0, "utf8");
  } catch (e) {
    process.stderr.write("zensu secret-scan: stdin read failed, failing open\n");
    return "";
  }
  let j;
  try {
    j = JSON.parse(raw || "{}");
  } catch (e) {
    process.stderr.write("zensu secret-scan: payload parse failed, failing open\n");
    return "";
  }
  const tool = j.tool_name || "";
  const ti = (j.tool_input && typeof j.tool_input === "object") ? j.tool_input : {};
  const candidates = [];

  if (WRITERS.has(tool)) {
    if (!pathExempt(ti.file_path)) candidates.push(ti.content);
  } else if (tool === "run_command") {
    const cmd = typeof ti.command === "string" ? ti.command : "";
    if (!cmd) return "";
    let channels = "";
    try {
      channels = detectChannels(cmd);
    } catch (e) {
      process.stderr.write("zensu secret-scan: channel detection failed, failing open\n");
      return "";
    }
    if (!channels) return "";
    const escaped = stripHeredocs(cmd).split(/\|\||&&|[;|\n&]/).some((seg) => {
      const toks = seg.trim().split(/\s+/).filter(Boolean);
      for (const t of toks) {
        if (!/^[A-Za-z_][A-Za-z0-9_]*=/.test(t)) break;
        const eq = t.indexOf("=");
        if (t.slice(0, eq) === "ZENSU_SECRET_SCAN"
            && t.slice(eq + 1).replace(/^["']+|["']+$/g, "") === "off") return true;
      }
      return false;
    });
    if (escaped) return "__bypass__:ZENSU_SECRET_SCAN";
    candidates.push(cmd);
  } else {
    return "";
  }

  const rules = new Set();
  for (const c of candidates) {
    if (typeof c !== "string" || !c) continue;
    for (const m of scan(c).matches) rules.add(m.rule);
  }
  return Array.from(rules).join(", ");
}

process.stdout.write(main());
