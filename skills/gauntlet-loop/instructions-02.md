## 7. Close the gap and repeat

On `CHANGE`, send the resolution to the responsible builder. Rebuild, rerun
hard gates, then run a new two-critic challenge with fresh Critic 1 and Critic
2. Do not reuse prior critics as if their accumulated context were fresh. Use a
fresh Critic 3 only when the new pair materially disagrees.

Continue without an arbitrary final round. Choose each next pass by expected
quality gain against the frozen bar. Keep a compact ledger:

```text
wave/round | artifact | C1 | C2 | arbiter if any | resolution | delta | budget
```

**A subagent's report never reaches the user.** The lead must lift every verdict,
number and decision into the ledger and the progress artifact, or the run becomes
invisible from outside.

For a long unattended run, maintain a user-visible progress artifact only in a
user-approved or task-designated location. Do not add progress files to product
source by default. See "Watching a long run" in
[references/harness.md](references/harness.md).

**Redact before every outbound write.** The evidence a round runs on comes from
the installed browser driver's console/network observations and live
screenshots — surfaces that routinely carry session cookies, bearer tokens, API keys
and the logged-in user's data. The rule is unconditional and covers every path that
carries those bytes onward: packet, ledger, resolution attachment and progress page
alike, whether the destination is local or published. Carry status, timing and a
redacted summary — never raw request or response headers or bodies. Strip console
output containing credentials, and look at each screenshot before it goes in. A
critic packet is not a private channel: it is delivered to a separate role pass, and a
builder pass that receives it has write authority. Keep third-party reference
captures local as well — scratch directory and critic packet only, never embedded
in a page published to an external host.

If the same gap persists or a metric regresses, stop repeating cosmetic fixes.
Recheck the diagnosis, measurement, coupling, and underlying architecture.
Assign a fresh root-cause pass, change strategy, or surface the real blocker.

After each major wave:

1. Use a dedicated integration pass for a bounded mutation pass that inspects the combined
   artifact for conflicts, coherence, and regressions; do not treat its opinion
   as a quality verdict. It is a write-capable pass pointed at untrusted content,
   so its packet carries the step-4 builder template's two mandatory lines — the
   authority bound and the untrusted-data boundary — verbatim.
2. Smooth inconsistencies without redesigning already passing concerns.
3. Rerun all hard gates.
4. Run the full two-critic challenge against the complete quality bar.
5. Use a third global arbiter on material disagreement.
6. Return the global `IMPLEMENTATION_RESOLUTION` to affected owners.
7. Reopen any local concern implicated by a global regression.

A local pass never implies a global pass.

## 8. Stop honestly

Stop only with an explicit status:

- `BAR_MET`: The actual artifact passes the frozen bar and receives either a
  paired `PASS` consensus or an evidence-backed arbitrated `PASS`, followed by a
  `NO_CHANGE` implementation resolution.
- `USER_STOP`: The user accepts or stops the run.
- `BUDGET_STOP`: The declared time, token, cost, or compute limit is reached.
- `CONVERGED_BELOW_BAR`: Further measured gains are immaterial after a
  root-cause or strategy review.
- `BLOCKED`: A missing decision, authority, input, capability, or safety
  boundary prevents meaningful progress.

Do not claim success for `BUDGET_STOP`, `CONVERGED_BELOW_BAR`, or `BLOCKED`.
Do not use hours spent, lines changed, agent count, or iteration count as
quality evidence.

Report:

```text
Status and stop reason:
Goal and frozen bar:
Artifacts actually inspected:
Baseline -> final evidence:
Hard and global gate results:
Critic 1, Critic 2, and arbiter verdicts:
Final implementation resolution:
Largest remaining gap:
Checks not run or limitations:
```

## Avoid common failure modes

- Do not let builders grade their own changes.
- Do not leak builder rationale into the critic packet.
- Do not let Critic 2 echo Critic 1 without independently inspecting the
  artifact and challenging the thesis.
- Do not infer consensus merely from identical `PASS` or `LOSE` labels.
- Do not skip Critic 3 when the pair materially disagrees.
- Do not forward conflicting critic instructions to builders.
- Do not turn compromise into an unsupported midpoint between two claims.
- Do not compare summaries when the real output can be inspected.
- Do not parallelize coupled systems or overlapping files.
- Do not optimize local pieces without a global integration gate.
- Do not accept non-reproducible captures or easy proxy metrics.
- Do not keep fixing a critic label when root-cause evidence contradicts it.
- Do not copy protected reference assets or imitate a living creator's style;
  use references as quality bars while preserving provenance and rights.
- Do not let another skill, connector, or standing workflow redefine this
  loop's goal or bar unless the task actually requires it.

## Provenance

The workflow preserves the source plugin's charter, evidence harness, builder/critic
packets, two ordered critiques, synthesis, conditional arbiter and explicit stop reasons.
Native critic execution uses distinct actual child UUIDs and protected completion receipts.
The charter still discloses limits of the inspection harness and any required blindness.
