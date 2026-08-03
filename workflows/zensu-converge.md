---
name: zensu-converge
description: Bidirectional flow-back audit of the current code state against the newest TDD plan Requirements table, with confirmation-gated plan edits. Load and execute the `converge` skill.
---

# /zensu-converge

Load and execute the **`converge`** skill (`skills/converge/SKILL.md`) in full,
applying all of its phases to the user's request. Pass along everything the user
provided after `/zensu-converge` (a plan path, flags) as the skill's input. Do not
summarize or skip the skill — follow it verbatim.
