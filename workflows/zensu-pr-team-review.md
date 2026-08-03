---
name: zensu-pr-team-review
description: Orchestrate a multi-agent PR/MR review on GitHub or GitLab — scout, cast a tailored team from a 25-persona pool, always evaluate changed-code test coverage, debate with an anti-groupthink challenge round, synthesize, validate every inline anchor, and publish one consolidated review through the VCS driver. Load and execute the `pr-team-review` skill.
---

# /zensu-pr-team-review

Load and execute the **`pr-team-review`** skill (`skills/pr-team-review/SKILL.md`) in full,
applying all of its phases to the user's request. Pass along everything the user provided after
`/zensu-pr-team-review` (the PR/MR URL, flags) as the skill's input. Do not summarize or skip the
skill — follow it verbatim.
