# Copilot 0.2.1 workflow repairs for Antigravity

This change preserves native Antigravity execution while repairing audit scope,
review closure, session identity and workflow reporting. It also adds an
interactive native acceptance runner with individual one-time approvals and
workspace-specific temporary trust. The previously open native Stop and worker
preparation checks now have successful, separately dated follow-up evidence. The
original full sweep remains recorded as 43 verified and two unverified; this is
not a new complete 45-scenario run or a claim of human acceptance.

## Implementation

An audit retry can no longer lose its retained baseline or dirty scope, dismiss
an unresolved claim, or turn a Git error into a clean receipt. Review packets
bind all required native children to fresh audit evidence, the current tree,
generation, runtime and exact prompt. Native write paths, explicit command cwd,
child result provenance, completed judges/consume, and terminal report behavior
retain their rejection checks. Budget locking tolerates normal contention while
preserving serialization and the existing deadlines.

The Stop acceptance probe arms a real workflow only after the control response,
then observes the actual block and completed same-session continuation before
ending its owned process. This observation does not claim workflow closure.
Ordinary interactive completion still requires a normal idle native Stop.
The production Stop gate and worker launcher are unchanged by this harness fix.

## Per-finding applicability and evidence

The following observations refer to the retained October 23 repair run, with the
later Stop and worker rechecks separated below. Fixture success is not native
proof. The complete original handoff and detailed machine-local records remain
outside the published source; the companion JSON retains bounded outcomes and
SHA-256 references without machine paths or private session records.

| Finding | Applicability and implementation | Validation on this repair set |
| --- | --- | --- |
| WF-001 | Copilot-specific wrappers/selectors do not apply. Retained AGY authoritative identity, exact helper authorization and native event schemas. No Copilot-only `rg` normalization was copied. | Session fixtures pass; fresh native audit binds the actual host UUID and denies a wrong inner session before execution. |
| WF-002 | Cumulative review inventory includes untracked files and commits since the retained baseline. The inherited `.git`/`.zensu` segment exclusion remains explicit. Bounded non-Git snapshots are supported; completed native reviews retain their Git-tree requirement. | Inventory fixtures pass; invoice packet and children bind the actual current tree. No native non-Git or mid-review-commit coverage is claimed. |
| WF-003 | The original documentation contradiction was already absent. The additional context-downgrade/Git-fault defect is repaired: baseline, cumulative dirty scope, generation, log prefix, claims and snapshots survive retries; fresh predicates are required. | Before/after Git-fault and invalid-proof fixtures pass. Fresh native audit retains a pending claim and certifies it with current proof despite omitted baseline/dirty options. Native Git-fault injection was not performed. |
| WF-004 | Documentation states native external Workflow import is unavailable. Shared importer/templates remain shipped and tested; native provenance remains mandatory. | Documentation and external-review fixtures pass. No native external import success is claimed. |
| WF-005 | The verification split was already present. Mandatory references and instruction bodies remain; linked audit-integrity/acceptance guidance adds bounded detail. | Instruction/reference/size checks pass. Native self-review loads both required instruction files and reads all nine current files. |
| WF-006 | Acceptance guidance retains bounded synthetic diagnostics while excluding credentials, subject data and raw network responses. | Guidance fixtures pass; native records contain bounded assertion evidence. This is not a general data-leakage audit. |
| WF-007 | Generation-bound workflow artifacts and per-session locking derive managed progress from fresh authoritative state. | Artifact/locking fixtures pass. Assisted native execution reaches revision 11 with all three managed rows completed after actual closure. Unattended adherence is not claimed. |
| WF-008 | Exact canonical packet bytes bind each aspect, judge and consume child to ticket, generation, round, runtime, tree and fresh audit receipt. | Packet/adversarial provenance tests and all eight actual invoice child contracts pass. |
| WF-009 | Substantive completed primary judge is required; the independent second judge cannot replace it. Completed native consume identity remains required. | Both judges and the distinct thin consume child complete and are consumed once. Its optional read denial remains recorded; the frozen thin-consume contract skips standalone inspection phases. |
| WF-010 | Bounded structured finding JSON validates schema, types and counts while retaining supported legacy input. Delimiters and shell-like text remain data. | Structured/malformed/oversized fixtures pass. Native verification executes on the actual empty set; nonempty finding reproduction is not proved. |
| WF-011 | Review quality is separate from effective configured fix routing; no critical-only policy is hard-coded. | Guidance/routing fixtures pass. Zero native findings do not exercise a live fix route. |
| WF-012 | One observed run may support separate AC records only for criteria it actually covers on the same tree. | Same-run/multiple-AC/stale-tree fixtures pass. Four current-tree records cite an observed run; independent package and README checks separately confirm behavior. |
| WF-013 | Closed-generation entry is report-only; reviewer launches/leases reject re-entry. Final reporting does not recursively reopen self-review. | Closed-generation fixtures pass. Both report corrections invoke only the closed report guard; all 365 protected files remain byte-identical. |

Additional regressions cover native `write_file`/`Path` protection, omitted versus
contradictory `Cwd`, actual child/result indexing, final-report accuracy, the B6
budget lock and Stop observation. No Copilot-only wrapper, selector, event schema
or `rg` normalization was ported. Shared importer/template files remain intact.

## Recorded validation

| Check | Recorded result | Boundary |
| --- | --- | --- |
| Complete local gate, October 23 | 79/79 suites; structure 77/77; configuration 57/57; offline promptfoo 110/110 | Unchanged executable snapshot, two outer workers. Earlier four-worker run was 78/79; isolated reruns and the complete retry passed without changing assertions or timeouts. Not a new PR CI result. |
| Focused interactive runner | 57/57 | Deterministic fixtures; no real model calls. |
| Full native suite, October 23 | 43 verified, two unverified; exit 1 | Original controlled Stop and worker preparation gaps; not 45/45. |
| Controlled Stop follow-up, October 23 | PASS | Actual native block, same UUID and completed individually approved helper call. No workflow-complete claim. |
| Worker follow-up, October 24 Europe/Berlin | UNVERIFIED; exit 1 | Fresh quota 429 after about 17.5 seconds, zero completed model responses, zero tool calls and no preparation receipt. Original timeout 180 seconds. |
| Worker follow-up, November 2 Europe/Berlin | PASS; acceptance exit 0 | AGY 1.4.8; exactly one completed `READY` response, zero tool calls and a real protected receipt bound to the native session, workspace and unchanged frozen runtime. Independent evidence 23/23; preservation 18/18. |
| Assisted invoice workflow | Completed native eight-child review chain, current-tree closure and report checks | Five explicit interventions, including missing self-review reads and two report corrections. Not unattended compliance or live finding-reproduction coverage. |
| Independent invoice npm package | 14/14 original assertions and direct installed CLI pass | Real consumer cwd; separate from plugin/native acceptance. |
| README and audit UX | Three executed examples; 25/25 audit checks | Bounded cases; no native Git-fault injection or general security certification. |

The observed native payload contains 325 files with runtime digest
`sha256:b73fc2936032f20b6efd0737c1eb7b3c0fe370bc53432222f2788d07f0281531`.
It was generated through `package-native.sh`; archive bytes were independently
compared with the extracted payload. This is the original v0.2.0 payload; the
resolved v0.5.0 integration has its own fresh verification below. This report
lives under `validation/`, which is outside the curated shipped runtime.

One explanatory sentence in `evals/promptfoo/live/INTERACTIVE.md` was clarified
after the full local snapshot. Executable code and test bytes remain identical.
All temporary trust entries were removed after owned processes exited; settings
were restored byte-for-byte and shared plugins remained unchanged.

## Fresh PR preparation checks — October 24

The isolated PR worktree passes registry validation, interactive tests **57/57**,
audit-scope **22/22**, native-session audit fixtures **7/7**, workflow artifacts
**6/6**, workflow guidance **6/6**, live-provider helpers **71/71**, and paired gate
verdict checks. These are deterministic fixtures, with no real model calls.

The first direct interactive-test invocation omitted the regular
`tests/prepare-runtime.js` prerequisite and three cases failed because the clean
worktree had no generated `hooks.json`. Running that existing preparation step,
which `tests/run-all.sh` already uses, resolved the setup failure; all tests and
gates stayed unchanged. Both attempts are retained in the local evidence.

A fresh `package-native.sh` build independently matches **all 325 files** of the
previously tested frozen payload. Only the ZIP container hash differs:
`8c5f1160c98bcd49c1ad38b7f5e3fc65c54e3dfc3788fac818f412111896e41d`.
This is a fresh package comparison, not another native acceptance run or a full
local-gate rerun. The original dirty checkout and its index remain unchanged.

## Successful native worker follow-up — November 2, before main integration

The unchanged production `harness/launcher.js --prepare` completed the original
`live-native-worker-prepare` scenario on **AGY 1.4.8**, from **08:46:57 to
08:47:20 UTC** (09:46:57–09:47:20 Europe/Berlin). The actual public transcript
contains exactly one completed `READY` response and **zero tool calls**. Its own
new CLI log names the exact disposable workspace and real native conversation.
A protected `0600` preparation receipt was created during the run and validates
against the immutable native identity, workspace, plugin root and runtime.

The original diagnostic assertion and opted-in unverified scanner both pass,
giving **acceptance exit 0**. Independent verification passes **23/23** checks;
preservation passes **18/18**. The catalog timeout remains 180 seconds, with the
original 120-second print limit, 150-second launcher limit and 210-second outer
provider limit. No model override, synthetic receipt, gate change or forced
cleanup was used. This resolves the previously observed worker quota blocker;
the October 24 failure remains historical evidence above.

The native build came from PR head
`b625a309beac25950a67f9c07568fbd90741f50e`. All **325** ZIP files independently
match its source or exact portable hook-template render; its runtime digest
matches the earlier tested payload. The native archive SHA-256 is
`8d9ce22a8d0edc46b125a36ea583eaa7dfcc38bda67576e462529907ebd32a92`.
This evidence update changes only files under `validation/`, outside the
shipped runtime.

Exactly one temporary workspace trust entry was removed after all owned
processes exited. Settings were restored byte-for-byte; no tool approval was
needed because no tool call occurred. Shared plugins and configuration, the
central handoff, and the original dirty checkout and index remained unchanged.

The supplementary independent checker initially omitted the schema's hash
domain prefix. It was corrected to the existing domain-separated session hash
and replayed against the same native evidence. The initial checker failure is
retained locally; no repository assertion, scanner, launcher or gate changed.

The previously missing preparation proof is now present. This targeted recheck
does not claim a new full suite on AGY 1.4.8, rerun the earlier assisted invoice
workflow or npm package checks, or establish human acceptance. The original
matrix and each follow-up retain their separate dates and limits. PR CI is
checked independently for the final documentation commit before merge.

## Main integration and fresh native worker proof — November 2

Current `main` at `63165be6d66aa9a8aa3e0e32695051f557a81275` contains native
runtime changes released after this repair branch: confirmed product-scoped work
capture, automatic context discovery, composed startup invocations and current
read/edit tool mappings. Its integration required resolving 52 conflicting files,
mostly shared native dispatch prose and overlapping adapter/test changes.

The resolution preserves both sets of functionality and every existing test
assertion. Native read/edit mapping coexists with strict `write_file` Path/Content
validation, including empty writes. Child correlation accepts a completed early
child result before its sibling result is recorded while rejecting malformed or
unfinished existing batch anchors. Live tests retain both explicit command-local
directory evidence and protected native workspace-binding evidence, plus frozen
interactive-root and candidate-stage discovery. Review packet, audit freshness,
normal idle child Stop, and one-time approval checks remain enforced.

Focused checks pass: native provenance **38/38**, session adapter **29/29**,
live-provider helpers **76/76**, both directory-proof fixture sets, registry
**5/5**, and all 32 skill body bounds plus seven lossless split procedures.
Registry counts and instruction hashes reflect the combined source; no assertion
or timeout was removed or relaxed.

The resolved **v0.5.0** runtime was frozen
again and tested through the unchanged production launcher on AGY 1.4.8, from
`2026-11-02T12:08:02.183374+00:00` to `2026-11-02T12:08:36.906809+00:00`. It produced exactly one
completed `READY` response, zero tool calls and a real protected bound preparation
receipt. Original assertion/scanner: **acceptance exit 0**; independent proof
**23/23**; preservation **18/18**. All **336** native package files match their
resolved source or exact portable hook render. Runtime digest:

`sha256:6b5bc1fdcf9cf4b52591b72f98fbffc7199817535bfa2dd4a7464f86afbb4193`

Native ZIP SHA-256:

`f066527164ca5e6021635d458152e31990ecd53c5c237bbbddd15435f3650b8c`

All 638 frozen integration source files must match the final source before push;
only validation documents are subsequently updated. One additional exact test
workspace was temporarily trusted. Its entry was removed after owned processes
exited, settings restored byte-for-byte, and shared plugins left unchanged.

The pre-integration success is retained above and in `workerFollowupHistory`.
The integrated runtime has its own proof; the original v0.2.0 receipt is not
reused as proof for v0.5.0. The earlier full native matrix and assisted invoice/npm
results remain historical; this is not a new full suite or human acceptance.
Merge remains conditional on successful CI for the final PR head.

To reproduce the deterministic gate, run `ZENSU_TEST_JOBS=2 bash tests/run-all.sh`
from a clean checkout after `npm ci`. The supported default remains unchanged.
For native testing, follow [the interactive runner instructions](../../evals/promptfoo/live/INTERACTIVE.md),
use a newly frozen package and fresh disposable workspaces, review each tool
request once, and remove only the authorized temporary trust entries afterward.

See [bounded evidence and original record hashes](evidence.json). Full local
logs and native records were retained separately; their hashes are provenance
references, not independently accessible proof for a remote reviewer.
