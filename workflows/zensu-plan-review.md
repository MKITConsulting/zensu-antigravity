---
name: zensu-plan-review
description: Multi-agent pre-implementation plan revalidator — cast a reviewer team, validate the plan read-only, return one report with a verdict + amendments. Load and execute the `plan-review` skill.
---

# /zensu-plan-review

Load and execute the **`plan-review`** skill (`skills/plan-review/SKILL.md`) in full, applying
all of its phases to the user's request. Pass along everything the user provided after
`/zensu-plan-review` (the plan or its path, flags) as the skill's input. Do not summarize or
skip the skill — follow it verbatim.
