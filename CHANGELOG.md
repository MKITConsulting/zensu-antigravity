# Changelog

All notable changes to `zensu-antigravity` are documented here. The format
follows [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

## [0.7.4] - 2026-11-03

### Added

- **ai-work**: Recover pending captures and preflight explicit scope (#29)

## [0.7.3] - 2026-11-03

### Fixed

- Keep Zen-mode session summaries, progress indicators and next steps in separate Markdown paragraphs in the Antigravity IDE.
- Prefer the latest trusted hook-injected progress anchor when a workflow becomes active during the same turn.
- Create the TDD log directory before the first guarded append in a fresh project, preserving existing path validation.

## [0.7.2] - 2026-11-03

### Fixed

- Remove ignored native manifest fields and exclude legacy command shims from the installable package.
- Discover native reviewer profiles from the host's agents directory while retaining exact identity, read-only tool, provenance and configuration checks.
- Rename the internal gate inventory to `hooks/inventory.json` and update all readers without changing gate order or decisions.
- Document public native downloads, checksum verification, installation and updates.

## [0.7.1] - 2026-11-03

### Added

- Present Zen-mode answers with the result first, a closing session goal and earlier-work recap, and the existing state-derived workflow progress.
- Respect user-selected presentation styles and preserve exact required workflow reports.

### Fixed

- Prefer the native host's current `lastUserInput` over compatibility prompt fields, including for the Zen-mode off switch.
- Reject completed-status and recap substitutions for next steps in first-turn reaction checks, and identify the native prose-envelope producer correctly.

## [0.7.0] - 2026-11-02

### Added

- **ai-work**: Require explicit feature scope for captured goals (#26)

### Fixed

- Preserve native audit evidence and require fresh review receipts throughout the workflow (#9).

## [0.6.0] - 2026-11-02

### Added

- **ai-work**: Bind automatic capture to a confirmed product (#24)

## [0.5.0] - 2026-10-28

### Added

- **capture**: Preserve plugin origin and explicit run purpose
- **context**: Automatically discover relevant features from task descriptions

## [0.4.3] - 2026-10-28

### Fixed

- **context**: Prioritize relevant evidence and preserve related sources (#19)

## [0.4.2] - 2026-10-27

### Fixed

- Support the Antigravity CLI 1.4.7 single-descriptor agent call and singular launch result while preserving older batch dispatch.
- Bind multi-call children to their actual completed parent result and exact accepted role when the host sidecar reports the final sibling step.
- Update native dispatch guidance and the two-child live verification without weakening read-only gates or normal-Stop completion requirements.

## [0.4.1] - 2026-10-26

### Added

- **context**: Load tracked feature context automatically (#16)

## [0.4.0] - 2026-10-26

### Added

- Record implementation context-package retrievals with the declared Antigravity host and retain the server-issued load receipt.
- Correlate subsequent knowledge-source retrievals with that package so the Context Board can show the authenticated account, server timestamps and returned source kinds.
- Report receipt failures explicitly and distinguish file references from local file reads or model understanding.

Requires Zensu CLI 0.13.0 or newer and the backend context-load endpoints. Deterministic CI validates the package; native provider sessions were not rerun for this instruction-only integration.

## [0.3.1] - 2026-10-25

### Fixed

- Normalize Antigravity CLI 1.4.7 `read_file`, `write_file` and `edit_file` names and Path/Target/Replacement fields so native file operations reach the existing read/write protection gates.
- Reduce cumulative startup overhead by composing pre-invocation advisory output in one Node process instead of spawning separate JSON, rendering and de-bounce helpers for every hook.
- Preserve engine order, startup context, private session binding, duplicate suppression, refusal precedence and the existing 90-second host deadline.
- Let native validation load a frozen candidate in isolated projects and select a process-local model without replacing the global plugin.
- Add a packaged startup subprocess budget and regression coverage for advisory composition. Tool authorization and Stop enforcement retain their existing path.

## [0.3.0] - 2026-10-25

### Added

- Automatically capture agreed implementation goals and new clean Git results through personal Zensu CLI authentication, including direct implementation mode.
- Bind capture to the native main conversation and its workspace with one-use helper authorization; reject unbound or child reporting.
- Persist retry-safe private receipts and provide idempotent explicit checkpoints plus a native Stop backstop.
- Return result-specific review links while keeping acceptance and revocation as explicit human web decisions. No code, prompts, transcripts or token usage are uploaded.

### Validation

- Verified the complete native CLI capture path with Antigravity CLI 1.4.7, Gemini 3.8 Flash medium and Zensu CLI 0.11.0, including authenticated ownership, duplicate prevention and no inferred acceptance.
- Recorded the observed startup-hook timeout and earlier excluded probes in the native validation report.

Requires Zensu CLI 0.11.0 or newer and the authenticated capture API. Missing prerequisites remain visible incomplete capture.

## [0.2.1] - 2026-10-24

### Added

- **context**: Load and hydrate linked feature evidence (#11)
- Package native Antigravity distribution (#6)

### Changed

- Archive Marketplace submission evidence (#8)
- Archive Google Marketplace submission evidence
- Record Antigravity Marketplace interest submission (#7)

### Added

- Native distribution packages with relative hooks, tracked-source validation and SHA-256 checksums, built without invoking Antigravity.
- Official Marketplace submission guidance and the integrations@zensu.dev support contact.

### Fixed

- Refuse staging inside host plugin roots even before those roots exist, and reject conflicting install/stage modes.
- Bootstrap release preparation with the same Node.js version and dependencies as CI.

## [0.2.0] - 2026-10-19

### Changed

- Port the complete Zensu 0.27.0 inventory: 32 skills/commands, canonical runtime policy,
  vanilla/strict modes, delivery routes, Zen mode, full-suite and acceptance receipts,
  session adoption/trail, chain recovery, autopilot adoption/release and leased work orders.
- Bind every native conversation to immutable project/runtime context and a validated CAS
  workflow baseline. Stateful calls use one-use exact helper authorization; missing state,
  conflicting session selectors and direct protected modules fail closed.
- Run review perspectives as real native child conversations with exact launch provenance,
  confined reads, protected completion receipts and tree/runtime/generation-bound tickets.
  Plan/PR review retains private evidence leases; Gauntlet uses separate critics and arbiters.
  Missing native proof blocks completion; source-host desktop metadata and native worktree
  ownership are never invented.
- Install helper scripts and the native worker harness; use a host-specific plugin-root
  pointer so a parallel source-host installation is not overwritten.

### Fixed

- Chain every applicable PreToolUse gate behind one native registration. The previously
  inactive writer secret scan and shell source-write gate now participate in the dispatcher.
  Live paired controls assert actual host denial and unchanged file state, not model prose.
- Preserve independent secret scanning when the opt-in shell source-write gate is disabled.
  Keep a prior deny when another handler emits context, allows, crashes or returns no output.
- Replace stale source-host callbacks and shared current-session discovery with native
  initialization, normalized events, exact tool-step correlation and explicit helper receipts.

### Added

- **The shim can record which hooks the host invoked, and which actually ran.** With
  `ZENSU_SHIM_TRACE` set to a file path, `antigravity-shim.sh` appends
  `<event> <script> <outcome>` per invocation; unset, it writes no trace and the emitted verdict
  is byte-identical. The live suite's hook-firing scenario previously could not pass anywhere:
  the provider read a trace nothing wrote, and the documented remedy was to hand-instrument the
  *installed* shim — which would have proved that a modified artifact fires, not the shipped one.
  The outcome column keeps the two claims apart: a hooks.json entry naming a script the staging
  step dropped is recorded as `bail-missing-script`, so it neither satisfies a requirement nor
  disappears from the report. Each probe gets its own trace path inside its throwaway workspace,
  so concurrent scenarios cannot delete each other's evidence.
- **tests**: `test-live-provider-helpers.sh` — deterministic coverage for the live provider's
  pure logic (trace parser, hook counters, unavailability classification, log correlation,
  hook-firing verdict). Until this existed that code could only ever run against paid quota,
  so a typo in it surfaced mid-sweep.
- **The initial matcher-gated live probes found
  that half of them never execute.** `live-hooks-fire-write` drives a real `write_to_file` and
  `live-hooks-fire-bash` a real `run_command`; no prompt-only scenario could reach those
  matchers, which left the question open for the whole port. **agy 1.1.10 invokes exactly one
  PreToolUse handler per matcher**, so `pre-write-secret-scan.sh` and
  `pre-bash-source-write-gate.sh` — both `hooks[1]` of their old entry — did not run before dispatcher chaining.
  Deterministic across three registration layouts, with the shim's `bailed` list empty every
  time: the second handler is never invoked, not failing. Different matchers are unaffected,
  and the matcher-less `PreInvocation` runs all of its handlers. Documented as a capability gap
  in `docs/architecture.md`; the replacement scenarios require both gates to run and paired probes to prove denial. Neither the installer nor `agy plugin validate` reports any of this.
  A run in which the model answers without calling a tool reports the new `LIVE-INCONCLUSIVE`
  marker and fails: the model's choice is a different diagnosis from a missing registration,
  and neither is a pass.
- **tests**: `test-results-shape.sh` — pins the promptfoo result-file shape and the live
  suite's unverified-scan, including that both consumers import the shared module rather than
  growing a private copy.
- **install**: a guard refusing `install.sh` when its source sits inside the host plugin
  root — applied to the staging target as well as the source, because `--stage-only <plugin
  root>` would otherwise `rm -rf` the live installation and then hand the host its own
  destination. That invocation makes source and destination the same path, and the host's copy
  truncates the plugin's own `plugin.json`, `hooks.json` and shims to zero bytes. The host
  has no such guard. The check compares physically-resolved paths on both sides, so a `$HOME`
  traversing a symlink (macOS `/var` → `/private/var`) cannot slip past it.
- **tests**: the install suite is now hermetic by construction — a stub `agy` on `PATH`
  records the host calls instead of reaching the developer's real registry, which also made
  the install path pinnable end to end (pointer content, config seeding, upgrade cleanup,
  uninstall). The host-key vocabulary moved to `tests/fixtures/host-manifest-keys.txt` so the
  structure suite and the promptfoo scenario cannot drift apart.
- **tests**: `test-manifest-host-keys.sh` — the manifest may declare only keys the host
  actually consumes. This is the one assertion that would have caught the original defect;
  reinstating `rules`/`workflows` makes it fail. Plus two promptfoo scenarios pinning the
  same invariant, and `test-command-skill-pairing.sh` (renamed from the workflow pairing
  suite) which now also asserts the shims are declared under `.commands[]`.
- **docs**: a "Verification status" section in `docs/architecture.md` recording what a live
  `agy` install actually does — verified-working claims, a table of earlier claims that live
  testing disproved, which components are inert on the agy CLI, and what remains unproven.
- **skills**: Eight new capabilities, each with its `/zensu-<name>` command shim —
  `/zensu-cover` (durable tests at the right level), `/zensu-verify-feature` (live
  verification of a built feature), `/zensu-pilot` (guided pipeline conductor),
  `/zensu-docs` (code-grounded per-feature documentation), `/zensu-converge` (flow-back
  audit of code against the plan), `/zensu-wargame` (executable-blind battle plan),
  `/zensu-doctor` (read-only setup diagnostics), and `/zensu-setup` (interactive
  first-run configuration).
- **agents**: `zensu-review-judge` — an independent second pass between the merged aspect
  findings and the consolidating reviewer, covering cross-cutting integration, requirement
  drift, and missed edge cases, and grading the panel itself (`Panel-FP:`). Plus
  `zensu-plan-review-worker` and `zensu-pr-review-worker` evidence workers.
- **hooks**: Secret-scan gate. `pre-write-secret-scan.sh` denies a write whose body carries
  a real-looking credential, and the raw-shell write gate scans the same content, so a
  credential cannot be smuggled through a heredoc or a redirect.
- **vcs**: Forge driver (`hooks/lib/zensu-vcs.sh`) with GitHub and GitLab detection and
  provider-agnostic PR/MR operations, wired into `pr-fix-findings`, `pr-team-review`, and
  `autopilot`. SSRF-hardened (host denylist, DNS resolution with private-IP rejection,
  TOCTOU-pinned requests).
- **pr-team-review**: Reviewer pool expanded 15 → 25 with an always-on core set and a
  challenge round against groupthink, always-on changed-code test-coverage evaluation
  rendered as a compact status table, and pre-publish inline-comment anchor validation
  (`hooks/lib/valid-diff-lines.js`) so no comment is posted against a line the diff does
  not contain.
- **tdd,autopilot**: Stable requirement IDs (`AC-###` / `FR-###`) allocated once in the plan
  and carried end to end through implementation, review, and validation.
- **autopilot**: Durable orchestration state (`hooks/lib/zensu-autopilot-state.sh`) so a run
  survives across sessions.
- **templates**: Artifact templates (`templates/`) with repo override, plus the shared
  additive-only repo-overlay mechanism (`hooks/lib/zensu-overlay.sh`) used by `tdd`,
  `cover`, and `pr-team-review`.
- **tdd**: Activation triggers and repo-local review personas
  (`hooks/lib/persona-activation.js`).
- **hooks**: Bypass ledger — every deliberate gate opt-out is recorded and surfaced instead
  of applied silently.
- **ghost-scan**: Multi-component scope gate and a cross-component deep journey pass.
- **evals**: `evals/promptfoo` — a 94-scenario offline capability proof suite driving the
  real hooks and libraries through an `exec:` provider in a disposable sandbox. Runs in CI
  as part of `tests/run-all.sh`; a results verifier fails the suite if a catalogued
  scenario silently never ran.

### Changed

- **Testing posture.** The deterministic gate cannot see the host. There is now an opt-in live
  suite — `ZENSU_LIVE_AGY=1 bash evals/promptfoo/live/run-live.sh` — that drives a real `agy`,
  resolves all 21 commands, reads agy's own CLI log for hook-parse rejections, observes which
  hooks fire, and exercises a full Stop block-and-resume cycle. Without the env var every
  scenario reports `LIVE-SKIPPED`, so CI stays hermetic. A scenario that cannot reach the host
  reports `LIVE-UNAVAILABLE` and fails the run rather than passing: "could not verify" must
  never read as "verified".
- **The Stop fix is now proven end-to-end, not just in shape.** A live probe arms the chain for
  the real conversation id and resumes that same conversation: the Stop hook ran 6 times against
  1 in the unarmed control, and the agent kept calling tools between blocks instead of ending its
  turn. The probe reports the enforcer's decision and the host's compliance as two separate
  claims — the enforcer will happily write block verdicts into a host that ignores them, which is
  precisely the bug that shipped. It caps the enforcer's anti-deadlock budget inside its own
  workspace so the cost does not scale with the operator's configuration.
- **Documentation corrected against live evidence.** Three claims this repo previously made
  were wrong: hooks *do* fire; a workspace `AGENTS.md` *is* read (the one working always-on
  channel — and it belongs to the user, not the plugin); and plugin `rules/` is inert for a
  broader reason than the manifest key, since the CLI importer skips the directory outright.
- **Historical agy 1.1.10 agent limitation (superseded above).** `agy plugin validate` reports
  `agents: 6 processed`, but the runtime logs `Agent "zensu-plm" not found`, `agy agents`
  lists none, and the host's `plugins.md` does not list agents as a plugin component. The
  files ship for the untested IDE build; on the CLI the review chain runs its five
  perspectives sequentially in-thread. No prose now asserts that a named agent WILL be
  spawned; where a skill still names one (the judge and consume-mode reviewer steps in
  `skills/tdd/SKILL.md`), the CLI falls back to running that stage in-thread.
- **BREAKING (manifest)**: the command shims move `workflows/` → `commands/` and
  `plugin.json` declares them under `commands`. `workflows` is not part of Antigravity's
  plugin schema — `agy plugin validate` recognises only `skills`, `agents`, `commands`,
  `mcpServers` and `hooks`, and drops anything else without a warning. The 21 shims were
  therefore inert and `/zensu-<name>` did not exist: the host answered
  "unrecognized slash command". Verified fixed against a live host — `agy -p "/zensu-doctor"`
  now loads the doctor skill.
- **BREAKING (install)**: `install.sh` is rebuilt around the host's real semantics.
  `agy plugin install <dir>` copies the directory into the host's own plugin root and
  registers it; it renders no templates and filters nothing. The installer now builds a
  curated staging tree OUTSIDE that root, renders `hooks.json` with the final destination
  baked in, and hands it to the host importer. Hand-staging never registered the plugin, so
  the previous install produced a plugin the host could not see.
- **skills**: Every skill description now opens with the `[Zensu] ` marker.

### Fixed

- **The hook-parse probe could report a clean bill of health for a log it never wrote.** It
  accepted whichever log in agy's shared log directory grew the most while it ran. Under
  `maxConcurrency: 2` a sibling probe's log easily grows more, so the heuristic picked the
  wrong file precisely when two probes overlapped — and `HOOK-PARSE-CLEAN` about a stranger's
  log is the exact failure the freshness check existed to prevent. The candidate must now also
  NAME this probe's own throwaway workspace, which agy records and no sibling can be running
  under; with no match the probe reports `LIVE-UNAVAILABLE` instead of reading someone else's
  evidence.
- **The promptfoo result-file shape lived in two places, one of them unreachable by any test.**
  `run-live.sh` carried a second copy inside a shell heredoc, and that copy ended in `|| []`
  — turning "I could not read this result file" into "nothing was wrong with it". Both
  consumers now import `lib/results-shape.js`, which throws on an envelope it cannot parse, and
  the scan itself moved into `live/scan-unverified.js` where `test-results-shape.sh` can load
  it. An unreadable result file now exits 2 and refuses the run rather than reporting green.

- **The host rejected two of five hook groups on every run.** `PreInvocation` and `Stop` take
  a FLAT list of handler objects; only `PreToolUse`/`PostToolUse` take the
  `{matcher, hooks[]}` wrapper. The template used the wrapper everywhere, so agy logged
  `Failed to parse hooks for plugin zensu: invalid hook "zensu-pre-invocation" …` to its own
  CLI log and ran without those groups — the intent router, the TDD reminder and the **Stop
  chain-enforcer** were inert in every session since 2026-08-04. Neither `agy plugin install`
  nor `agy plugin validate` reported anything. Verified fixed: zero parse errors in the host
  log, and all five groups observed firing in a live session.
- **The advisory verdict shape was one the host ignores.** `PreInvocation` reads
  `{"injectSteps":[{"ephemeralMessage":…}]}`; the plugin emitted an allow-plus-context object.
  That is why no zensu advisory had ever reached the model — and why the earlier
  "hooks may not fire" diagnosis looked plausible. `emit-verdict.js` is now per-EVENT and the
  shim passes the event as its second argument.
- **The Stop backstop could never block.** On `Stop`, `{"decision":"continue"}` is the only
  value that holds the turn open; any other value lets the agent stop. The plugin forwarded
  the engine-neutral `decision:"block"` — and only under `ZENSU_AG_STOP_BLOCKS=1`, which
  defaulted off — so the review chain's guarantee was decorative. The shim now translates
  block → continue unconditionally.
- **A PreToolUse advisory no longer emits `decision:"allow"`.** On that event "allow" means
  *auto-approve the tool call*, skipping the permission prompt the user would otherwise see.
  A convention nudge must never buy a tool call a free pass, so a non-deny message from a
  pre-tool hook is dropped. Denials are unaffected. This is a deliberate, documented gap.
- **Session state could detach mid-run.** agy sends a stable `conversationId` in every hook
  payload; `normalize-payload.js` ignored it and fell back to a PPID heuristic. agy does not
  spawn every hook of a run from the same parent — two distinct session ids inside one run
  were reproduced twice — and each rewrote the current-session pointer, so chain state armed
  early in a run became invisible later in it. `conversationId` is now the session id.
- **hooks**: The shim never normalized the writer tools' body argument, so any
  content-inspecting write gate was a silent no-op. `normalize-payload.js` now probes the
  writer body and folds replacement chunks.
- **hooks**: Non-hook state writers (`zensu-log.sh --chain-done`, `--tdd-*`, `--phase`)
  inherit no project dir from the host, so inside a worktree they anchored state to the
  terminal's cwd and could deadlock the Stop-hook review chain. A cwd-independent resolver
  (`hooks/lib/resolve-project-dir.js`) recovers it at one choke point.
- **tdd**: The review-chain Stop backstop is re-armed for every session chain.
- **state locks**: A state write could be lost under concurrency on Linux — for autopilot
  a repeated irreversible pipeline step, and the same defect sat in the TDD chain's lock.
  Both selected between the GNU and BSD `stat` dialects by exit status. GNU
  `stat -f %m DIR` does not fail cleanly the way BSD's does: on an existing directory it
  prints a filesystem report to stdout and exits 1, so the `||` chain handed that text on
  as a timestamp, `$((now - mtime))` evaluated a bare word from the report as a variable
  name, and under `set -u` the whole writer process died mid-critical-section — its write
  simply never happened. Only reachable under contention, where the lock directory is
  replaced between the two stat calls, which is why it surfaced on a loaded CI runner and
  never on a fast laptop. Both locks now pick the dialect by output shape and validate the
  result is numeric.
- **autopilot**: Reclaiming a stale lock deleted it in place, which is several syscalls,
  so two waiters could both judge the same lock stale, the first delete it and take a
  fresh one, and the second then delete *that* fresh lock and take one too. Reclamation is
  now an atomic rename — eight racing waiters yield one winner where the previous behavior
  yielded eight. The stale threshold also moves 30s → 300s, because a starved host makes a
  working lock look abandoned, and each mutation retries its critical section a bounded
  number of times rather than dropping the write. A contended acquire no longer leaks a
  shell redirection error to stderr: the owner-file read is a redirection, so
  `tr 2>/dev/null` never suppressed it.
- **tests**: The skill-frontmatter check read only the first line of a `description`, so
  folded YAML descriptions skipped the length and prefix assertions entirely and three
  over-long descriptions had passed. The extractor now understands folded and literal
  blocks, and the manifest/pairing cardinalities are derived from the filesystem instead of
  frozen literals.

### Removed

- **`ZENSU_AG_HOOK_CONTRACT` / `ZENSU_AG_STOP_BLOCKS`**: the two probe knobs that existed only
  because the verdict schema was an open question. The host's own spec settled it, so the
  dialect is fixed and the knobs are inert; the suites pin them as inert so nothing quietly
  starts honouring them again.
- **install.sh `--target`**: the IDE/CLI two-destination flag. The host owns a single
  destination, so the flag had no meaning; `/zensu-setup` and `/zensu-doctor` were updated to
  stop instructing users to pass it, which the new parser now rejects.

- **rules/**: the three always-on steering files and the `rules` manifest key. The host
  ignores the key, so nothing they said ever reached the model (a probe rule's token came
  back absent, and the CLI importer logs `rules: skipped` and registers no such component).
  There is no plugin-side substitute channel; a plain `AGENTS.md` in the USER's workspace root
  IS read, but that is the user's file to write, not the plugin's. Their content was audited:
  the CLI discipline pointers and the routing rule already lived in `agents/zensu-plm.md`,
  the core model in `skills/zensu-help/`, and
  the write-gate rationale verbatim in the gate's deny message. The two behaviours with no
  working carrier — the plan-first TDD prompt and the compaction nudge — are now documented
  as explicit capability gaps in `zensu-help`, the README and `docs/architecture.md` instead
  of being implied to work.

## [0.1.0] - 2026-06-30

### Added

- Initial release of Zensu — a Product Lifecycle Manager plugin for Google Antigravity.
- Native `plugin.json` manifest with 13 skills, 13 `/zensu-<name>` workflow shims, and
  3 subagents (`zensu-plm`, `zensu-code-reviewer`, `zensu-review-aspect`).
- Event hooks wired through `hooks/antigravity/antigravity-shim.sh` — the single
  host-translation layer that normalizes payloads and emits verdicts.
- Always-on `rules/` steering (`zensu-conventions`, `zensu-tdd`, `zensu-write-gate`) for the
  behaviors that have no Antigravity hook event (the session banner/primer and the per-prompt
  advisories).
- Lazy first-call session-id capture (Antigravity has no SessionStart event), so per-session
  FSM state and the pulse journal still converge.
- `install.sh`: stage the plugin into the IDE and CLI plugin paths, generate `hooks.json`
  with absolute paths from `hooks.json.template`, seed `~/.zensu/config.json`, and write the
  `~/.zensu/plugin-root` pointer.
- CLI-driven: every Zensu operation runs through the typed `zensu` CLI (≥ 0.2.0); the plugin
  ships no MCP configuration.
- Deterministic offline test gate (`tests/run-all.sh`): the `tests/structure/test-*.sh` suite
  plus the `evals/config-gate` offline matrix.
