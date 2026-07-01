---
name: zensu-pr-team-review
description: Orchestrate a multi-agent PR review on GitHub — scout, cast a reviewer team, debate, synthesize, publish one consolidated review via `gh api`. Load and execute the `pr-team-review` skill.
---

# /zensu-pr-team-review

Load and execute the **`pr-team-review`** skill (`skills/pr-team-review/SKILL.md`) in full,
applying all of its phases to the user's request. Pass along everything the user provided after
`/zensu-pr-team-review` (the PR URL, flags) as the skill's input. Do not summarize or skip the
skill — follow it verbatim.
