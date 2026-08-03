---
name: zensu-ghost-scan
description: Scan an existing repository for undocumented features and import them into Zensu as tracked features. Load and execute the `ghost-scan` skill.
---

# /zensu-ghost-scan

Load and execute the **`ghost-scan`** skill (`skills/ghost-scan/SKILL.md`) in full, applying
all of its phases to the user's request. Pass along everything the user provided after
`/zensu-ghost-scan` (product ID, repo path, flags) as the skill's input. Do not summarize or
skip the skill — follow it verbatim.

**Multi-component products.** If the user names this repo as one component of a larger product,
carry that into the skill along with which components remain unscanned: Phase 5's scope gate
defers per-component journey creation until every component exists, and Phase 5b is the single
cross-component deep journey pass that runs after the last one. To run only that final pass on
an already-fully-scanned product, say so — the skill enters at Phase 5b.
