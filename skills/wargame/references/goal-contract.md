# The Goal Contract + Cohort-Until-Parity Loop

Read this when a mission is best framed as a **goal to prove**, not just a route to plan — audits, correctness proofs, invariant checks, coverage sweeps, security reviews, "prove X can never happen." Also read it whenever the user opens with `/goal ...`.

## Why a goal contract

A wargame gives you the route. A goal contract gives you the **win condition the route must satisfy** — stated tight enough that "done" is not a judgment call. Without it, a plan drifts: the executor does *something* plausible and declares victory. The contract is the referee.

A goal contract is short. It is the header of the wargame, not a second document.

## The four parts of a contract

Every goal contract states these. If the user's `/goal` line is terse, infer the parts from it and write them out explicitly — then confirm the risky inferences with a `RECON NEEDED`.

1. **Objective + exhaustiveness** — what must be proven, and over what set. "Every mutation of X" means you first enumerate the set (every mutation path, every status, every ownership state) and then the contract binds you to *all* of it, not a sample. Name the enumeration source (schema, state machine, route table) so coverage is checkable, not vibes.

2. **Invariants to prove or break** — the specific properties that must hold, written as things you actively try to violate. "Flag anything with more than one owner, or that can have multiple write owners" is an invariant: single-writer ownership. The job is to *find a counterexample or prove none exists*, per invariant.

3. **Evidence bar** — what counts as proof. "E2E against a live schema, no mock tests" is a bar: a claim only lands if it was exercised against the real system end to end. Mocks, dry reasoning, and "should work" do not clear the bar. State the bar so a finding with weaker evidence is rejected automatically.

4. **Convergence loop** — when to stop. "Run your findings through a cohort until you have parity" defines done as *consensus across independent checks*, not one pass. See below.

## Contract format

Write the contract at the top of the wargame doc:

```markdown
## Goal contract

- **Objective**: prove <property> over <the full set>, enumerated from <source>.
- **Exhaustiveness**: <how the set is enumerated and how coverage is measured>.
- **Invariants** (each: hold or produce a counterexample):
  - INV-1: <e.g. every data point has exactly one write-owner at all times>
  - INV-2: <...>
- **Evidence bar**: <e.g. every claim exercised E2E against the live schema; no mocks; reproduction command recorded>.
- **Convergence**: native perspective checks (separate child contexts); done at parity (see loop).
- **Out of scope**: <what this contract does NOT cover>.
```

The wargame moves below the contract are then the route that *discharges* it: recon that enumerates the set, moves that test each invariant, verification that meets the evidence bar.

## Perspective-until-parity loop

Use the native read-only advice procedure in `{plugin_root}/docs/native-reviewers.md` for distinct verifier children and actual completion receipts. Agreement is not correctness. Do not claim blinded verification if the packet reveals earlier conclusions or the hidden reference.

For code missions, apply the full review panel from `skills/tdd/references/review-chain.md`: conventions, bugs, architecture, tests and security. Supply each pass with the same complete `REVIEW PACKET v1`, naming unrun checks and their reasons. Merge the findings, perform a judge pass, and verify each surviving claim against the cited code. This standalone audit does not fabricate a TDD ticket or gated completion.

For non-code missions, use three distinct native advice children appropriate to the claim, such as rule validity, arithmetic and source support. Each tries to refute the claim using the original evidence. Collect every actual child result and disclose any inspection or blindness limits.

Track rounds and disagreement. Repeat when new or contradicted findings require investigation. Only evidence-supported claims enter the final report; report a bounded non-convergence instead of inventing agreement.

## How it changes the SUCCESS grade

A contracted wargame must additionally satisfy:

- Coverage is measured against the enumerated set, and the doc says what fraction is covered and what is not (ties to point 4, RECON NEEDED).
- Every surviving claim cleared the stated evidence bar (strengthens point 6).
- The doc records the perspective rounds and the parity result — the attacks that failed and the patches from the ones that landed. For code missions, cite which `review-aspect` perspectives ran and what they returned (this IS point 7, made concrete).
