# PLAN.md — Review Round 1 (record)

Audit-quality record of the single review round that hardened the
`zensu-antigravity` master implementation plan before build. Three adversarial
reviewers audited `PLAN.md` against the live CC / codex / kiro sources; every
finding was resolved in `plan-amendments.md` and applied to `PLAN.md` in place.
This file is the reviewed-one-round artifact.

## Reviewer lenses

1. **Architecture / fidelity** — does the port preserve CC's guarantees, and are
   the FULL-vs-DEGRADE claims earned (not asserted on a guess)? Caught the
   PreInvocation re-fire (BK5), the witness-field overclaim (BK7), the
   source-write fidelity split (MJ1), and the sandbox misdiagnosis (MJ4).
2. **Correctness / consistency** — do the facets agree on wiring, names, and
   contracts; would the build artifact actually fire? Caught the shim command
   grammar (BK1), agent/rules filenames (BK2/BK3), the edit-matcher (BK4), the
   cwd/workspace derivation (BK6), and the env-flag test contracts (MJ8).
3. **Completeness / loss** — what did the port silently drop versus CC? Caught
   the `evals/config-gate` suite (BK8), the README hook-count test self-break
   (BK10), the OSS governance meta-files (MJ7), and the disposition gaps (MN8).

## Finding counts

| Severity | Count | IDs |
|---|---|---|
| **BLOCKER** | 10 | BK1–BK10 (BK10 folded in from MN10's fix; treated as blocker) |
| **MAJOR** | 8 | MJ1–MJ8 |
| **MINOR / NIT** | 10 | MN1–MN10 |
| **Total actioned** | 28 | all ACCEPTED, all applied |

Plus a **Verified-green** set (5 items) confirmed correct, requiring no change.

## BLOCKERS

| ID | severity | finding (1 line) | resolution (1 line) |
|---|---|---|---|
| BK1 | BLOCKER | Facet-1 (absolute-path `$1`) and facet-2 (bare-script `$1`) disagreed on the shim command grammar → silent fail-open. | Canonical: `bash …/antigravity-shim.sh <bare-script>.sh`; shim resolves `$ROOT/hooks/$1`; `test-hooks-json-shape.sh` asserts no `/` in the `$1` token. |
| BK2 | BLOCKER | Agent filenames inconsistent; Scenario-A delegate filters on agent id `zensu-code-reviewer`, so the prefix is load-bearing. | `zensu-`-prefixed everywhere (tree, §4a/§4e, plugin.json `agents[]`, tasks, tests). |
| BK3 | BLOCKER | plugin.json `rules[]` listed stale `zensu-tdd-protocol.md` / `zensu-session-primer.md` not matching the authored files. | `rules[]` = `zensu-conventions.md`, `zensu-tdd.md`, `zensu-write-gate.md`; `test-rules-presence.sh` asserts each exists AND is listed. |
| BK4 | BLOCKER | Edit-matcher carried CC-only `Edit\|Write\|MultiEdit` + non-existent `create_file\|edit_file`; risk of dropping `multi_replace_file_content`. | Matcher exact: `write_to_file\|replace_file_content\|multi_replace_file_content`; multi-block writer kept so it can't bypass the phase-gate. |
| BK5 | BLOCKER | PreInvocation fires before every model step, not once per turn → advisory hooks re-inject every tool round (context bloat + steering loop). | Shim CONTEXT branch de-bounces `(script,context)` per turn via `.zensu/state/preinv-<sid>.txt`; `test-preinvocation-debounce.sh`; §4b/§6/§8 updated. |
| BK6 | BLOCKER | Source-write rule-B computes `projectRoot=CLAUDE_PROJECT_DIR`/`curdir=cwd`; if both come from the command cwd the cross-worktree escape can never fire. | Shim exports `CLAUDE_PROJECT_DIR` from `workspacePaths[0]`, passes command cwd separately as `cwd`; `test-source-write-gate.sh` cross-worktree DENY case added. |
| BK7 | BLOCKER | Witness rated FULL on a guess; the `tool_response.stdout` (`tail=`) field has no verified AG source. | Downgraded to "FULL pending PostToolUse result-field verification"; normalizer multi-key-probes result stdout→`tool_response.stdout`; Phase-6 fails loud on empty `tail=` while active; `test-post-bash-witness.sh`; PostTool-fields promoted to High. |
| BK8 | BLOCKER | CC's `evals/config-gate/` (~55 deterministic offline tests) silently dropped; headline count "~26" wrong. | Port `evals/config-gate/` wholesale; wire `run-eval.sh --self-check` into `tests/run-all.sh`; tree §3 + §4g + §7 updated; gate ≈110 (≈55 structure + ≈55 config-gate). |
| BK9 | BLOCKER | Plan widened lib root-headers; ground truth = codex/kiro left `hooks/lib/*.sh` byte-identical to CC, breaking the upstream-sync diff base. | Libs copy byte-identical; root-chain widening lives ONLY on top-level `hooks/*.sh` + `zensu-runtime.sh`; §3/§4b/§4a(AGENTS.md)/P0 corrected. |
| BK10 | BLOCKER (folded) | `test-readme-hook-count-sync.sh`'s CC regex matches `antigravity-shim.sh` on every line → count collapses to 1. | Rewritten to parse the wrapped-script token after `antigravity-shim.sh `; README `### Hooks (N)` = distinct wrapped scripts (shares the MN10 fix). |

## MAJORS

| ID | severity | finding (1 line) | resolution (1 line) |
|---|---|---|---|
| MJ1 | MAJOR | Source-write-gate rated a single FULL; its two rules have different wiring dependencies. | §6 split: (A) tracked-file clobber = FULL; (B) cross-worktree escape = FULL once BK6 lands, else DEGRADED, with the dependency shown. |
| MJ2 | MAJOR | `superset` (two verdict keys) presented as proven-safe; a strict parser may reject the foreign key → deny fails OPEN. | Framed as a PROBE pinned before any reliance; V1 live-probe MUST assert the deny actually BLOCKS under `CONTRACT=superset`, then pin one flavor. |
| MJ3 | MAJOR | Synth id `ag-$(date +%s)-$$` diverges across the 3 first-turn shim subprocesses (different `$$`); last `mv` wins. | Deterministic `ag-$(zensu_session_key)` (PPID-based, stable across the turn); §4b + capture-sid + `test-session-id-fallback.sh` updated. |
| MJ4 | MAJOR | B-3 premised on a shared `~/.zensu/state` becoming unreachable — a misdiagnosis (state is project-local). | Re-scoped to real sandbox unknowns: hook READ of `~/.zensu/*` + WRITE of `$workspace/.zensu/state`; single-vs-per-dest has no state-coherence consequence; §8 B-3 + V12 rewritten. |
| MJ5 | MAJOR | Facet-2 body shipped a default Scenario-A PostToolUse delegate entry; hooks.json renders verbatim, so the default must be safe. | `hooks.json.template` ships NO PostToolUse subagent-completion entry; Scenario A kept as documented upgrade prose only. |
| MJ6 | MAJOR | Agent `tools:` frontmatter unpinned; CC-specific `TaskCreate`/`TaskUpdate` would carry over; reviewers could be write-capable. | Pin all 3: `review-aspect`=`read,grep,glob`; `code-reviewer`=write-free `read,run_command,grep,glob`; `plm`=swept CC allowlist; drop Task* ; `test-agents-present.sh` asserts reviewers write-free. |
| MJ7 | MAJOR | OSS governance meta-files (`SECURITY.md`, `CODE_OF_CONDUCT.md`, `CONTRIBUTING.md`) absent from the manifest. | Added to tree §3 + §4a + P3: SECURITY/CoC verbatim, CONTRIBUTING adapted; `OSS_READINESS_REPORT.md` consciously dropped for v1. |
| MJ8 | MAJOR | Shim-test env contracts wrong (`A|B`) and `ZENSU_AG_STOP_BLOCKS` not a real knob. | (a) parameterize on `{superset,allow_tool,decision,exit}`; (b) `ZENSU_AG_STOP_BLOCKS` honored in the BLOCK branch (`1`=Stop-block shape, `0`=advisory); §4b/§4d + shim tests pin real behavior. |

## MINORS / NITS (applied)

| ID | severity | finding (1 line) | resolution (1 line) |
|---|---|---|---|
| MN1 | MINOR | In the worst quadrant (advisory Stop + no completion event) the only round cap is an advisory Stop. | SKILL.md prose: after `autoFixMaxRounds` run `--code-review-done` UNCONDITIONALLY; §4d + §6 updated. |
| MN2 | MINOR | Stop variant left in "pending" limbo between kiro/codex. | v1 ships the codex no-guard variant + `.stopblocks` cap; kiro guard gated behind the Stop-agent verify; stated in §4d. |
| MN3 | NIT | "FULL" could be read as "fails closed." | Added: a normalizer/gate crash classifies RAW → tool allowed (convention nudge, not a security boundary); §6/§4d. |
| MN4 | MINOR | `context-nudge` reads a CC-specific transcript schema AG won't match → wasted parse + misfire if wired. | Ships unwired; essence folded into `rules/zensu-conventions.md`; PreInvocation array shrinks to 2; §4b table/event-map/§6/§8 updated. |
| MN5 | NIT | `apply_patch` dead branch; risk the patch-envelope fallback misfires on a single-`TargetFile` payload. | Single-file path wins when `file_path` present; `files.length===0` must not misfire; example tool names fixed; `test-pre-edit-phase-gate.sh` pins it. |
| MN6 | NIT | `config.example.json` omits `bashWriteGate` though it's an advertised escape hatch. | Added `"bashWriteGate": true` for discoverability; behavior unchanged (absent → default-enabled). |
| MN7 | NIT | Stray duplicate `plugin.json (declared)` line in tree §3. | Removed. |
| MN8 | NIT | Source dispositions (evals/scripts/docs/runner flags/recursive staging) not stated. | Explicit disposition block added to §4g; `--self-check`/`--live` omitted v1; confirm recursive `hooks/` staging + `node --check` all `.js`. |
| MN9 | NIT | `zensu-runtime.sh` framed as a CC port (CC has no such file). | Provenance corrected to codex/kiro in §3 + P0 task 3. |
| MN10 | MINOR | Hook count not reconciled authoritatively; counting source undefined. | 13 CC wired → 8 wrapped (context-nudge now unwired); README "Hooks (N)" = wrapped-script tokens; pinned together with the BK10 test rewrite. |

## Verified-green (no change needed)

- **CLI-class invariant** — `ZENSU_MUTATION_TOOL_NAMES ⊇ cli-map mutations ⊇ skills'
  `--workflow-begin --tools`` — preserved by the byte-identical `zensu-mcp-tools.sh` +
  `zensu-cli-map.sh`.
- **Version same-value invariant** (minus `marketplace.json`) — consistent across
  `plugin.json` + README badge + CHANGELOG.
- **English-only + German match-literal carve-out** — kept in lockstep, owned by
  `user-prompt-tdd-reminder.sh`, not duplicated into rules.
- **skill-workflow-marker test** — still meaningful: operates on `skills/*/SKILL.md`;
  the review self-loop is prose and emits no un-wrapped `zensu` mutation.
- **Env-var names, marker contract, session-id resolution order** — all internally
  consistent.

## Disposition

All 28 findings ACCEPTED and applied to `PLAN.md` in place. No finding was deferred
or rejected. The plan is cleared for build (§7, P0→P5); the live probes in §5
(V1/V2/V3, then V4/V7 + the new PreInv-debounce / PostTool-fields rows) pin the
remaining "pending" defaults during P5.
