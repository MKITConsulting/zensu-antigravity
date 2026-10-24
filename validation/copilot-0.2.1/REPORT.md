# Copilot 0.2.1 workflow repairs for Antigravity

This change preserves native Antigravity execution while repairing audit scope,
review closure, session identity and workflow reporting. It also adds an
interactive native acceptance runner with individual one-time approvals and
workspace-specific temporary trust. Native acceptance remains partial: worker
preparation has not yet produced a successful protected receipt.

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
| Assisted invoice workflow | Completed native eight-child review chain, current-tree closure and report checks | Five explicit interventions, including missing self-review reads and two report corrections. Not unattended compliance or live finding-reproduction coverage. |
| Independent invoice npm package | 14/14 original assertions and direct installed CLI pass | Real consumer cwd; separate from plugin/native acceptance. |
| README and audit UX | Three executed examples; 25/25 audit checks | Bounded cases; no native Git-fault injection or general security certification. |

The observed native payload contains 325 files with runtime digest
`sha256:b73fc2936032f20b6efd0737c1eb7b3c0fe370bc53432222f2788d07f0281531`.
It was generated through `package-native.sh`; archive bytes were independently
compared with the extracted payload. The PR preserves that payload. This report
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

## Remaining native acceptance

The production `harness/launcher.js --prepare` must complete exactly one tool-free
`READY` response and create its protected preparation receipt bound to the real
session, workspace and frozen runtime. The latest observed quota estimate is
historical, not a claim that the path is currently ready. No model substitution,
synthetic receipt, timeout increase or gate relaxation replaces this proof.

The diagnostic scenario assertion accepts an inconclusive marker, but the
unchanged opted-in unverified scanner correctly makes the run fail. Keep this
PR in draft while that native proof is missing.

To reproduce the deterministic gate, run `ZENSU_TEST_JOBS=2 bash tests/run-all.sh`
from a clean checkout after `npm ci`. The supported default remains unchanged.
For native testing, follow [the interactive runner instructions](../../evals/promptfoo/live/INTERACTIVE.md),
use a newly frozen package and fresh disposable workspaces, review each tool
request once, and remove only the authorized temporary trust entries afterward.

See [bounded evidence and original record hashes](evidence.json). Full local
logs and native records were retained separately; their hashes are provenance
references, not independently accessible proof for a remote reviewer.
