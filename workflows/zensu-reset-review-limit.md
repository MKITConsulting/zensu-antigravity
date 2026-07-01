---
name: zensu-reset-review-limit
description: Reset the auto-fix loop round counter so the review chain can resume past the autoFixMaxRounds budget within the current task. Load and execute the `reset-review-limit` skill.
---

# /zensu-reset-review-limit

Load and execute the **`reset-review-limit`** skill (`skills/reset-review-limit/SKILL.md`) in
full, applying all of its phases to the current worktree. Pass along everything the user
provided after `/zensu-reset-review-limit` as the skill's input. Do not summarize or skip the
skill — follow it verbatim.
