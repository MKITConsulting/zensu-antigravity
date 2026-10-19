# promptfoo capability proof suite

Offline, deterministic evidence that every shipped capability actually behaves as
documented. Each scenario drives **real plugin artifacts** — hook scripts through the
Antigravity shim, shell libraries, the manifest — inside a disposable sandbox.

No network. No model call. No `agy` binary. No API key — for **this** suite. The provider
is an `exec:` provider, so it is safe to run in CI and is part of the deterministic gate
(`tests/run-all.sh` runs it).

The `live/` suite alongside it is the opposite by design: it drives a real logged-in `agy`
and makes real model calls. It is opt-in (`ZENSU_LIVE_AGY=1`), never part of the gate, and
is the only harness here that can observe the host rather than our own artifacts.

## Run it

```bash
npm ci
bash evals/promptfoo/run-eval.sh
```

`--self-check` validates the config, the provider and the scenario catalog without
evaluating anything.

## Layout

| Path | Role |
|---|---|
| `promptfooconfig.yaml` | The suite: one provider, one shared assertion, every scenario catalog. |
| `lib/zensu-provider.js` | The exec provider. Builds a disposable Git project and private session baseline, substitutes the sandbox account home through a test-only preload, runs the scenario, and returns a JSON envelope `{kind, exit_code, stdout, stderr}`. |
| `assertions/expect.js` | The shared assertion. Reads the scenario's `expect` object and checks every declared predicate. |
| `scenarios/*.yaml` | One catalog per capability domain. |
| `verify-results.js` | The gatekeeper — see below. |
| `lib/results-shape.js` | The promptfoo result-file shape, implemented **once**. promptfoo has shipped both a flat `results` array and a nested `results.results`; every extra copy of that knowledge is a place the suite can start reading zero rows, which is indistinguishable from a clean run. It throws on an envelope it cannot read rather than defaulting to empty. |
| `live/scan-unverified.js` | Reads the live result rows and reports which scenarios verified NOTHING. Exit 0 clean, 1 with findings, 2 when the result file itself could not be read. |
| `lib/agy-live-provider.js` | The LIVE provider. Drives a real `agy` instead of the plugin's own artifacts — the only harness here that can observe the HOST. |
| `live/` | The opt-in live suite: `ZENSU_LIVE_AGY=1 bash live/run-live.sh`. Real model calls, so it is deliberately NOT part of `tests/run-all.sh`. Skipped runs report `LIVE-SKIPPED`; an unreachable host reports `LIVE-UNAVAILABLE` and fails the run. |

## Scenario shape

```yaml
- description: "write-gate: free-standing feature creation is denied"
  vars:
    scenario_id: write-gate-create-denied      # unique across the whole suite
    kind: hook                                  # hook | shell | manifest
    hook: pre-bash-zensu-gate.sh
    event: PreToolUse                           # optional; resolved from hooks/hooks.json
    config: { hooks: { tddImplementation: true } }   # optional ~/.zensu/config.json
    setup: |                                    # optional: arm session state first
      bash "$ZENSU_PLUGIN_ROOT/hooks/lib/zensu-log.sh" --tdd-begin
    payload: { conversationId: "__SESSION__", workspacePaths: ["__PROJECT__"], toolCall: { name: run_command, args: { CommandLine: "..." } } }
    expect:
      exit_code: 0
      stdout_json: { decision: deny }
```

`kind: hook` feeds `payload` to the hook through `hooks/antigravity/antigravity-shim.sh`
(use `dialect: flat` to bypass the shim and address the hook directly). `kind: shell` runs
`script` with the plugin libraries reachable. `kind: manifest` reads a file from the plugin
root.

The tokens `__PROJECT__`, `__DATA__`, `__HOME__` and `__SESSION__` are substituted with the real sandbox
paths inside `payload`, `script`, `setup` and `env` values, so scenarios stay portable.

Available predicates: `exit_code`, `stdout_contains`, `stdout_not_contains`,
`stdout_contains_any` (at least one alternative must appear), `contains`, `not_contains`,
`matches`, `not_matches`, `stdout_json` (dotted paths).

Live scenarios use a different var shape — `probe` (`command` | `hooklog` | `hookfire` | `gatewrite` |
`stopcycle` | `prompt`), `prompt`, `timeout_s`, `command` (required by the `command` probe,
e.g. `zensu-doctor`), and optionally `require_fired` (a SPACE-SEPARATED string of
`<event>:<script>` pairs a hook-firing probe must observe as `ran` — never a YAML list,
which promptfoo expands into one run per element) or `trace_file`.

`gatewrite` runs the exact same synthetic write with its gate disabled and enabled.
It requires the disabled control to write the expected bytes, a matching decision receipt
from the enabled gate, and unchanged target bytes after the denial. The suite resolves all
32 commands to their exact skill identities and includes an unknown-command control.

Synthetic tool, gate and Stop probes use `--dangerously-skip-permissions` so print mode can
execute their authorized fixture operations without an unanswered native permission prompt.
The provider permits that flag only for physical `zensu-live-*` directories directly under
the operating system's temporary directory. The enabled leg must still prove that a hard
hook denial prevents execution; automatic approval alone never constitutes a passing result.

They rely on `stdout_contains_any` to accept `LIVE-SKIPPED` / `LIVE-UNAVAILABLE` /
`LIVE-INCONCLUSIVE` without asserting a skip away. `run-live.sh` fails the run on
`LIVE-UNAVAILABLE` and `LIVE-INCONCLUSIVE` always, and on `LIVE-SKIPPED` only after an
explicit `ZENSU_LIVE_AGY=1` opt-in — without the opt-in a fully skipped run is the
expected hermetic outcome and exits 0.

The three markers are distinct diagnoses, not severities: `LIVE-UNAVAILABLE` means the
host could not be reached (quota, login, network, a killed process); `LIVE-INCONCLUSIVE`
means it WAS reached but never did the thing the probe exists to observe — most often a
tool-call hook group required while the model answered without calling a tool;
`LIVE-SKIPPED` means the probe never ran. All three fail a run that opted in, because
none of them verified anything.

## Why `verify-results.js` exists

A green promptfoo run is not sufficient on its own: a config that silently evaluated zero
scenarios also reports zero failures. The verifier reads the catalogs, requires that every
catalogued `scenario_id` actually ran, and requires that each one passed. A scenario that
declares no expectation at all fails rather than passing vacuously.

## Adding a capability

When a new capability lands, add its scenarios to the matching catalog (or a new one, and
register it in `promptfooconfig.yaml`). Cover the happy path, the refusal path, the
documented escape hatch, and the malformed-input path — a gate that cannot be shown to
refuse is not evidence of anything.
