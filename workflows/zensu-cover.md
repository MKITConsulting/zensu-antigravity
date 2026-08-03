---
name: zensu-cover
description: Author durable, committed tests at the right level for a change — probe the repo, decide unit/component/integration/e2e per behavior, write them green-first. Load and execute the `cover` skill.
---

# /zensu-cover

Load and execute the **`cover`** skill (`skills/cover/SKILL.md`) in full, applying all of its
phases to the user's request. Pass along everything the user provided after `/zensu-cover`
(the target — a diff, feature id, PR number, path glob, or described behavior — plus flags)
as the skill's input. Do not summarize or skip the skill — follow it verbatim.
