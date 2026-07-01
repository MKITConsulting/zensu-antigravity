---
name: zensu-tdd
description: Run the Zensu strict-TDD build (RED→GREEN + guaranteed review chain). Load and execute the `tdd` skill.
---

# /zensu-tdd

Load and execute the **`tdd`** skill (`skills/tdd/SKILL.md`) in full, applying all of its
phases to the user's request. Pass along everything the user provided after `/zensu-tdd`
(feature spec, file paths, flags) as the skill's input. Do not summarize or skip the skill —
follow it verbatim.
