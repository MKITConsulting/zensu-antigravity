# Zensu for Antigravity

![version](https://img.shields.io/badge/version-0.2.1-blue)
![host](https://img.shields.io/badge/host-Google%20Antigravity-blue)
![license](https://img.shields.io/badge/license-FSL--1.1--Apache--2.0-blue)

Zensu is a Product Lifecycle Manager plugin for Google Antigravity. It combines tracked
features, implementation discipline, evidence checks, review, security and delivery through
the typed `zensu` CLI. This port follows the complete **Zensu 0.27.0** feature inventory:
**32 skills, 32 commands and seven reviewer/role assets**. The exact source revision, retained
requirements and native limitations are documented in [the parity matrix](docs/upstream-parity.md).

Implementation defaults to **vanilla**. Strict RED→GREEN is opt-in via
`hooks.tddImplementation=true`; evidence audits, the review chain and completion gates remain
active in both modes when a workflow is armed. A user's explicit direct-implementation choice
is retained. No workflow is silently armed after that choice.

## Install

Requirements: a logged-in `agy` CLI, authenticated `zensu` CLI, Node.js, Bash and Git.
Windows needs Git Bash. CLI behavior is verified separately from the unverified IDE importer.

```bash
bash install.sh
```

The installer stages the manifest, skills, commands, roles, plugin-owned rules, templates, docs, runtime,
scripts and harness outside the host installation, renders `hooks.json` from
`hooks.json.template`, then invokes `agy plugin install`. It writes
`~/.zensu/antigravity/plugin-root` and seeds `~/.zensu/config.json` only when absent.
Existing configuration is preserved. Run `zensu auth login` if authentication is missing.
Use `bash install.sh --dry-run`, `--stage-only <directory>` or `--uninstall` as needed.
Never install directly from the installed copy: source/destination overlap can truncate it.
Restart the IDE after updating; IDE execution remains a separate verification target.

### Native package and Marketplace

The native release artifact, `zensu-antigravity-native-v<VERSION>.zip`, contains a curated
`zensu/` directory with ready-to-run, relative hook commands. Verify its checksum against
the release's `SHA256SUMS`, extract it outside Antigravity's plugin directory, then run:

```bash
agy plugin install /absolute/path/to/extracted/zensu
agy plugin validate ~/.gemini/config/plugins/zensu
agy plugin list
```

Start a fresh CLI conversation and run `/zensu-help`. The plugin binds its actual installed
root and version when the conversation begins. The native package needs no installer or
postinstall script and preserves existing Zensu configuration. For updates, extract and
verify the new package first, run `agy plugin uninstall zensu`, then install the extracted
directory. Native imports merge files; uninstalling first prevents obsolete rules and hooks
from surviving an update. The source ZIP is a separate artifact: use its `install.sh`, rather than importing
the unrendered repository directly.

Google now offers an [official curated Antigravity Marketplace](https://antigravity.google/docs/marketplace?tab=cli).
Zensu's publisher interest form was submitted on 2026-10-19 and is **awaiting Google's
review; not yet listed**. There is no documented Claude-style custom marketplace manifest
to add to this repository.
Contact **integrations@zensu.dev** for package access and support while listing is pending.
See [distribution and submission details](docs/distribution.md).

Maintainers can build the native artifact from a Git checkout without a logged-in host.
Every packaged source file must be tracked; local-only descendants are rejected:

```bash
bash package-native.sh /absolute/path/to/output
# Or inspect just the curated directory:
bash install.sh --portable-stage-only /absolute/path/to/stage
```

## Commands

Each `/zensu-<name>` command loads the matching bundled skill. Commands that create a PR,
publish review feedback or mutate tracked features describe the corresponding authority in
the skill; choosing a local implementation route alone does not grant publication authority.

| Capability | User types |
|---|---|
| Vanilla or strict build with evidence and review | `/zensu-tdd` |
| Implement a tracked feature end-to-end | `/zensu-implement` |
| Autopilot — idea → validated PR | `/zensu-autopilot` |
| Bootstrap a product (greenfield) | `/zensu-bootstrap` |
| Ghost scan (brownfield import) | `/zensu-ghost-scan` |
| Security review (classification, STRIDE, gate) | `/zensu-security-review` |
| Self-review (chain terminus) | `/zensu-self-review` |
| Plan review (multi-perspective, pre-code) | `/zensu-plan-review` |
| PR review perspectives (GitHub or GitLab) | `/zensu-pr-team-review` |
| PR fix findings (resolve review threads) | `/zensu-pr-fix-findings` |
| Backfill durable tests at the right level | `/zensu-cover` |
| Verify a built feature live (worktree or preview) | `/zensu-verify-feature` |
| Guided pipeline conductor (step-by-step delivery) | `/zensu-pilot` |
| Code-grounded per-feature documentation | `/zensu-docs` |
| Audit the code against the plan (flow-back) | `/zensu-converge` |
| Wargame a mission into an executable-blind plan | `/zensu-wargame` |
| Read-only setup diagnostics | `/zensu-doctor` |
| Interactive first-run configuration | `/zensu-setup` |
| Pulse (developer journal) | `/zensu-pulse` |
| Reset the auto-fix round counter | `/zensu-reset-review-limit` |
| Zensu Q&A / glossary | `/zensu-help` |
| Inspect/adopt the current session | `/zensu-adopt-session` |
| Inspect/adopt an orphaned autopilot run | `/zensu-autopilot-adopt` |
| Release an eligible autopilot run | `/zensu-autopilot-release` |
| Select a delivery route | `/zensu-delivery-route` |
| Select local or CI full-suite verification | `/zensu-full-suite` |
| Bounded builder/critic refinement | `/zensu-gauntlet-loop` |
| Recover a contradictory review chain | `/zensu-recover-chain` |
| Native conversation history and handoff | `/zensu-session-trail` |
| Select vanilla or strict implementation | `/zensu-tdd-mode` |
| Execute an exactly bound work order | `/zensu-work` |
| Set session-scoped Zen behavior | `/zensu-zen-mode` |

## Enforcement

Antigravity 1.1.10 invokes only one matching PreToolUse handler. The plugin therefore
registers **one dispatcher**, which runs all applicable engine gates itself. File-edit calls
reach the private-data guard, optional strict phase gate and secret scanner. Shell calls
reach the typed-CLI mutation gate, optional source-write guard, secret scanner and browser
consent checks. Session/principal and work-order checks also run. A deny wins over every
other result; a later allow or advisory cannot erase it. A neutral result explicitly requests
the native permission path with `ask`; advisory text is dropped. The only native automatic
permission grant is a fully audited batch of exact registered read-only reviewer/worker
profiles under `reviewerSpawnAutoAllow`, after every gate accepts and launch provenance is
recorded. A mixed batch, withdrawn configuration or sibling ask/deny prevents that grant.

- `hooks.bashWriteGate` defaults to **false**, matching upstream. Enabling it protects
  source edits through shell commands. The independent secret scanner defaults to **true**.
- `hooks.mcpGate` defaults to **true**: known reads are allowed, unknown and mutating Zensu
  operations require a workflow's explicit tool grant.
- The default review panel is **lean**; automatic fixes target **critical** findings with a
  default maximum of **two rounds**. Strict phase enforcement, full panels and broader fix
  thresholds remain configurable.
- Full-suite and acceptance gates default to **required**. Evidence includes the actual
  command result and source-tree fingerprint. Stale, absent or contradictory receipts cannot
  masquerade as current success; explicit escapes remain visible in the bypass ledger.

See [configuration](docs/configuration.md), [gate semantics](docs/gates.md),
[review severity](docs/review-severity.md) and [architecture](docs/architecture.md).

## Session and review authority

The native `conversationId` binds an immutable project/runtime record and a private workflow
baseline. Parallel conversations never share a current-session pointer. Missing or corrupt
state is diagnosed or explicitly recovered; repeated initialization does not recreate it.
Stateful model calls use the exact helper prefix injected by the adapter:

```text
bash <plugin-root>/hooks/antigravity/session-helper.sh --session <conversation-id> --helper log -- --chain-status
```

The PreToolUse guard binds a one-use receipt to that exact call. The wrapper validates it,
clears caller-selected authority and supplies the actual private data/root internally. Use
`--stdin-file <absolute-file>` for bounded structured input; unsupported shell wrappers and
forged session selectors are denied.

The verified CLI supports registered native reviewer profiles through `invoke_subagent`.
TDD review binds actual child UUIDs and normal child-Stop receipts to the one-shot ticket,
source tree and runtime. Plan/PR reviews enforce exact-file/safe-root private leases, then
finalize, collect and close the complete generation. Raw child findings remain immutable;
the main conversation verifies and classifies the merged report before canonical routing.
Gauntlet uses distinct Critic 1, Critic 2 and conditional arbiter conversations. Separate
contexts prove separate execution, not that every judgment is correct.

## Always-on policy and host limits

On agy 1.4.2, the plugin-owned `rules/AGENTS.md` loads through the native rule channel
without a manifest `rules` key. It supplies workflow routing, direct-choice preservation,
evidence discipline and native reviewer authority even when no hook fires. The earlier
agy 1.1.10 inert-rule observation does not describe this verified channel. The installer
ships this product policy and never edits the user's workspace `AGENTS.md`; repository
development conventions are not installed as product instructions. Rule loading steers
the model; runtime gates still enforce session, capability and completion checks.

The native host lacks the source platform's SessionStart/SubagentStart/SessionEnd and
plan-approval events. First-registration bootstrap and PreInvocation provide the supported
steering. Child identity and completion are derived from verified native spawn/transcript/Stop
evidence; no source-host child event is assumed. Context-compaction recovery remains unverified.

Session Trail reads actual native conversation metadata and transcripts. Indexed status
alone does not prove process liveness or exclusive ownership. Source-host desktop accounts,
task chips, worktree-archive protection and Session Hub handover receipts are not fabricated.
Reanchor refuses when native ownership evidence is unavailable. The complete list of native
adaptations and limits is in [upstream parity](docs/upstream-parity.md).

## Verification

```bash
bash tests/run-all.sh
ZENSU_LIVE_AGY=1 bash evals/promptfoo/live/run-live.sh
```

The deterministic gate runs structure, semantic unit, native-adapter and offline fixture
checks without external services. The live suite drives the installed `agy`, resolves all
commands, correlates host logs to each throwaway workspace and observes the shipped shim.
It tests actual Stop blocking/resumption and pairs each write-gate denial with a successful
disabled-gate control using exact target/content evidence. A model merely saying “blocked”
is insufficient. Skipped, unavailable and inconclusive probes are not verified passes.

`ZENSU_SHIM_TRACE` records `<event> <script> <outcome>`. Optional
`ZENSU_SHIM_DECISIONS` records verdict witnesses and hashes, not full commands or file contents.
Neither variable patches the installed runtime. See the generated reports in `tests/results/`
and `evals/promptfoo/live/results/`; the validation report records the actual final run.

After explicit plan approval, the four delivery choices are autopilot to a reviewed PR, the guided workflow
(`/zensu-tdd`), tracked-feature Pilot, and implementing directly. The existing preference
fast paths and route restrictions apply; native PreInvocation alone is not a plan approval.
Answer the route question with the Zensu workflow once: the session remembers that answer
only after the bound helper records it. A declined helper call records nothing, so the
question can return. A direct answer decides that plan or request only; use
`/zensu-delivery-route --direct` to select direct implementation for the session. A
configured `hooks.defaultDeliveryRoute` can decide the route without asking. The user's
own explicit preference still wins for the current request; Autopilot and Pilot remain
per-plan choices. See [delivery-route configuration](docs/configuration.md#hook-opt-out).

## Feature context retrieval

Tracked implementation loads the linked context package through
`zensu knowledge context-pack <feature-ref> --json`, then hydrates relevant items
with `zensu knowledge get <item-id> --json` and reads referenced files from the
authorized checkout. Supplementary search uses `--json` so passages are retained.
The CLI must expose `knowledge context-pack --help`; older installations report
the missing capability instead of silently falling back. See the
[context procedure](skills/implement/references/knowledge-context.md)
for truncation, access failures and evidence handoff. These reads supplement feature,
security and design context. They do not record agent usage.
