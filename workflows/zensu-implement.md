---
name: zensu-implement
description: Implement a tracked Zensu feature end-to-end (context + security profile, TDD, artifact linking). Load and execute the `implement` skill.
---

# /zensu-implement

Load and execute the **`implement`** skill (`skills/implement/SKILL.md`) in full, applying all
of its steps to the user's request. Pass along everything the user provided after
`/zensu-implement` (feature ID, flags) as the skill's input. Do not summarize or skip the
skill — follow it verbatim.
