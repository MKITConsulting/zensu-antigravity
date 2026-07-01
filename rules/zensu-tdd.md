# Zensu TDD — Plan First, Then Ask

For any task that **adds or modifies executable code**:

1. **Plan first.** Outline the change before touching code.
2. **Ask before the first edit** whether to run the strict Zensu TDD flow (`/zensu-tdd`).
   Ask as a plain numbered question — e.g. "Run the Zensu TDD workflow for this?
   1) yes  2) no" — and wait for the answer.
3. On **yes** → run `/zensu-tdd`: RED→GREEN under the phase-gate, then the review chain.
   On **no** → implement directly.

**Skip the ask** only for: doc-only changes, a non-interactive / unattended run, or when
the user has **already signalled a TDD preference**. Honor an existing preference both ways
— if the user already said they want TDD, just run `/zensu-tdd`; if they said they do not
want it (or told you to "just do it / go ahead / get on with it"), implement directly
without asking. Detect these signals from the user's own words in whatever language they
wrote them; do not re-ask once a preference is on record. (The exact preference match
literals live in the hook script, not here — this rule is the always-on behavior that
holds even when no hook fires.)

## Vanilla vs strict

`/zensu-tdd` honors `hooks.tddImplementation` (default `false` — **vanilla**). In vanilla
mode there is no RED→GREEN ceremony and the edit gate passes through, but the evidence
audits and the review chain stay enforced; word the ask as "Run the Zensu workflow
(vanilla implementation + review chain)?". Set `hooks.tddImplementation:true` for the
strict RED→GREEN gate. The mode is frozen per session at `--tdd-begin`.

## Finish the review chain

After implementation, the review chain must complete: five `zensu-review-aspect`
perspectives (or one `zensu-code-reviewer` pass) → fix every Critical/Important finding →
finish at the terminal `/zensu-self-review`. Do not end the turn with implementation done
but the chain unfinished.
