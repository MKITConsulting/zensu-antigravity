# promptfoo capability proof suite

Offline, deterministic evidence that every shipped capability actually behaves as
documented. Each scenario drives **real plugin artifacts** — hook scripts through the
Antigravity shim, shell libraries, the manifest — inside a disposable sandbox.

No network. No model call. No `agy` binary. No API key. The provider is an `exec:`
provider, so the suite is safe to run in CI and is part of the deterministic gate
(`tests/run-all.sh` runs it).

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
| `lib/zensu-provider.js` | The exec provider. Builds a sandbox (temp project, state dir, `HOME`), optionally seeds `~/.zensu/config.json` and project fixtures, runs the scenario, and returns a JSON envelope `{kind, exit_code, stdout, stderr}`. |
| `assertions/expect.js` | The shared assertion. Reads the scenario's `expect` object and checks every declared predicate. |
| `scenarios/*.yaml` | One catalog per capability domain. |
| `verify-results.js` | The gatekeeper — see below. |

## Scenario shape

```yaml
- description: "write-gate: free-standing feature creation is denied"
  vars:
    scenario_id: write-gate-create-denied      # unique across the whole suite
    kind: hook                                  # hook | shell | manifest
    hook: pre-bash-zensu-gate.sh
    env: { ZENSU_AG_HOOK_CONTRACT: superset }
    config: { hooks: { tddImplementation: true } }   # optional ~/.zensu/config.json
    setup: |                                    # optional: arm session state first
      bash "$ZENSU_PLUGIN_ROOT/hooks/lib/zensu-log.sh" --tdd-begin --session pf
    payload: { toolCall: { name: run_command, args: { CommandLine: "..." } } }
    expect:
      exit_code: 0
      stdout_json: { allow_tool: false }
```

`kind: hook` feeds `payload` to the hook through `hooks/antigravity/antigravity-shim.sh`
(use `dialect: flat` to bypass the shim and address the hook directly). `kind: shell` runs
`script` with the plugin libraries reachable. `kind: manifest` reads a file from the plugin
root.

The tokens `__PROJECT__`, `__DATA__` and `__HOME__` are substituted with the real sandbox
paths inside `payload`, `script`, `setup` and `env` values, so scenarios stay portable.

Available predicates: `exit_code`, `stdout_contains`, `stdout_not_contains`, `contains`,
`not_contains`, `matches`, `not_matches`, `stdout_json` (dotted paths).

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
