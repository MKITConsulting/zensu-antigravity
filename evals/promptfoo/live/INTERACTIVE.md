# Interactive native live suite

The live suite retains its 45 scenarios and their assertions: 32 command
resolutions, one unknown-command control, nine hook and gate checks, one native
agent check, one rules check, and one worker preparation check. It makes real
model calls through a logged-in `agy`. The deterministic repository gate does
not supply this evidence.

Interactive mode uses the native TUI so an operator can review each ordinary
tool request and approve it once or reject it. It never sets a permission bypass,
an automatic approval mode, or an allowlist. A disposable workspace restricts
the test's scope; it does not authorize a tool call.

## Prepare an isolated run

Build and independently verify a native plugin stage with the repository's
current packaging tools. Keep that stage immutable for the whole run. Set
`ZENSU_LIVE_PLUGIN_ROOT` to its canonical absolute directory containing
`plugin.json`, the native adapter, and generated `hooks.json`. The provider
copies that exact stage into each claimed workspace's `.agents/plugins/zensu`
and rewrites only that disposable workspace's registry to its local copy.
agy 1.5.6 rejects registry paths outside the workspace. Native evidence must
identify the local copy and the frozen digest; the shared installation is never
an acceptable fallback. Neither the template nor a shared installation is edited.

Run the owned preparer with the canonical frozen plugin path and, optionally,
a canonical physical temporary parent directory:

```sh
node evals/promptfoo/live/prepare-interactive.js /absolute/frozen-plugins/zensu
```

It reads the live config and scenario YAML, rejects missing or duplicate
identifiers, and requires the existing 45 scenarios. It creates a unique
evidence directory, all scenario workspaces, `workspaces.json`, and
`preparation.json`. Its JSON output includes the exact environment values for
the runner, the frozen runtime digest, and hashes of the unchanged catalogs.
It does not launch `agy` or read or change trust settings.

The generated `ZENSU_LIVE_EVIDENCE_DIR` is a physical directory inside temporary
storage. Each preallocated workspace is a physical immediate child of its
`workspaces/` directory. Each basename matches
`zensu-live-[A-Za-z0-9]+`, and each directory must initially contain only:

- `note.txt`, containing exactly `probe workspace` followed by a newline.
- `.agents/plugins.json`, containing an `entries` array with one object whose
  `path` is the frozen plugin's parent directory and whose `include_only` array
  contains the frozen plugin's basename.

The regular JSON manifest uses the exact `scenario_id` values from
`scenarios/*.yaml`, with every scenario and workspace appearing once:

```json
{
  "schema": "zensu-live-workspaces-v1",
  "entries": [
    {
      "scenarioId": "live-command-zensu-help",
      "workspace": "/private/tmp/your-unique-run/workspaces/zensu-live-a1b2c3"
    }
  ]
}
```

This example illustrates one entry; a full run needs all 45 actual scenario
identifiers. The provider rejects aliases, symlinks, duplicate entries, reused
claims, and unexpected initial workspace contents. It records each selected
workspace under `workspace-claims/` before copying the plugin and preparing its scenario. A rerun needs
new workspaces and a new manifest; preserve the earlier run's results.

The host must already trust each exact workspace. Obtain explicit authorization
for those individual temporary paths before adding them through the supported
host settings mechanism. Do not trust their parent directory or add permanent
tool permissions. Preserve the original settings bytes and record the exact
authorized change so cleanup can remove only those temporary entries without
overwriting unrelated changes. The runner checks exact workspace trust before
launching and never grants trust itself.

## Run with one-time approvals

From a real terminal at the repository root, supply the prepared paths:

```sh
ZENSU_LIVE_AGY=1 \
ZENSU_LIVE_INTERACTIVE=1 \
ZENSU_LIVE_PLUGIN_ROOT=/absolute/frozen-plugins/zensu \
ZENSU_LIVE_EVIDENCE_DIR=/private/tmp/your-unique-run \
ZENSU_LIVE_WORKSPACE_MANIFEST=/private/tmp/your-unique-run/workspaces.json \
bash evals/promptfoo/live/run-live.sh
```

`run-live.sh` runs interactive scenarios serially with
`--max-concurrency 1`. The native TUI is relayed through the controlling terminal
even though promptfoo's own output is saved to `results/last-run.txt`. A missing
terminal fails; there is no headless approval fallback.

Review the displayed native request and highlighted option before each input.
AGY 1.4.3's creation dialog ignores the documented `y` shortcut. Press Enter
only when the highlighted native option approves this one inspected call;
use `y`/`n` only where the host supports those shortcuts, or `Ctrl-C` to abort
the owned run. The relay forwards these explicit operator keys and refuses
pasted prompts, navigation, persistent-choice selectors and mode changes.
It does not infer from a key alone that the selected native option was safe:
retain the actual proposal and operator review evidence. Never confirm an
unknown or persistent choice. Do not provide additional instructions to make a
scenario pass. An abort, refusal, timeout, missing tool attempt, or unavailable
model remains visible evidence and cannot count as a successful observation.

An optional `ZENSU_LIVE_MODEL` selects an explicit native model identifier.
`ZENSU_LIVE_INTERACTIVE_TIMEOUT_S` sets a bounded per-turn timeout from 1 to
3600 seconds; otherwise the transport uses at least 300 seconds and honors a
longer scenario timeout. These options do not change scenario assertions.

The worker preparation scenario intentionally calls the frozen
`harness/launcher.js --prepare` path. That native preparation call uses print
mode for its prescribed no-tool response and must produce its real private
preparation receipt. It uses the already trusted scenario workspace; the
interactive runner does not substitute a receipt or an approval mode.

## Evidence and completion

Interactive transport returns the actual public final model text, its native
session UUID, and sanitized native transcript rows. It does not manufacture
native JSON or stream events. Verification correlates the exact workspace,
session, own CLI log, private runtime binding, frozen plugin digest, literal
user prompt, completed transcript, and normal fully idle Stop decisions.
Thinking fields are excluded from exported transcript rows.

Each native turn has a unique `runs/turn-*` directory containing its request,
own CLI log, hook decisions, raw terminal capture, operator input events,
transport result, and bounded observations. A successful turn also records
`native-evidence.json` and `result.json`. The provider preserves each scenario
workspace and writes a separate `zensu-live-*.result.json` containing the
workspace and native evidence references. Promptfoo results remain under
`results/`. Hook firing still comes from the shipped shim's event/script/outcome
trace; no hook is instrumented or replaced.

The agent scenario requires two actual flat `invoke_subagent` calls, one per
role, and uses the frozen adapter to parse their actual completed host results.
Existing child prompt, parent linkage, workspace, runtime, tree, protected-read
denial, final-output hash, and normal idle Stop checks still apply. The Stop
scenario retains its paired unarmed/armed observations in the same native UUID
with the same literal prompt; operator messages cannot supply a second path to
completion.

The Stop pair installs one disposable workspace `PostInvocation` fixture hook
in both legs. It is inert in the control; after the second leg's initial model
response it arms only the captured native UUID using the frozen canonical
helpers. This prevents pre-invocation recovery from starting a review before
the Stop under test. The shipped plugin, its hooks and all enforcement gates
remain unchanged. The arming receipt, immutable native context and unchanged
workspace-hook hash are part of the observation.

Only this Stop probe uses bounded continuation observation: the original
paired proof must pass, the armed leg must first try a tool-free Stop, and any
resumed tool must actually complete. After two stable observations the relay
records the proof, cancels that owned experiment and exits its TUI. It reports
`stop-continuation-observed`, never workflow completion or a normal idle turn.
The process must still exit 0 with no cleanup error and unchanged settings.
An ordinary timeout, operator abort, missing block or unfinished resumed tool
remains unverified. Ordinary runs retain the normal idle completion gate below.

After two unchanged observations establish a normal idle turn, the relay sends
`/exit` only to that owned native process. This does not mark a Zensu chain
complete. In ordinary completion mode, forced termination and interrupted turns
cannot become passes; the separate Stop-observation mode above claims only its
already observed block and continuation, never completed workflow execution.
`LIVE-UNAVAILABLE`, `LIVE-INCONCLUSIVE`, and an unreadable result envelope fail
the opted-in suite through the existing result verifier and unverified scanner.
The process exit status alone is insufficient; inspect the complete 45 results.

If process cleanup is denied or times out, `transport.json` retains the original
failure, owned PID, attempted cleanup operation and error. An unconfirmed exit
is explicit; the provider reports the cleanup error instead of treating a
missing result as completion. Inspect that exact process before removing trust.
Do not infer process exit from the existence of a transport file.

After the run, independently verify the frozen payload, shared installations,
repository state, and original settings. Remove only the authorized temporary
trust entries with a compare-and-swap check against the expected settings state,
or stop cleanup for review if unrelated changes appeared. Preserve workspaces,
results, operator decisions, failures, and cleanup evidence for the report.
