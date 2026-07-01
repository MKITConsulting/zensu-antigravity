---
name: zensu-bootstrap
description: Bootstrap a new Zensu product from a vision document (features, journeys, security, tiers, AGENTS.md). Load and execute the `bootstrap` skill.
---

# /zensu-bootstrap

Load and execute the **`bootstrap`** skill (`skills/bootstrap/SKILL.md`) in full, applying all
of its phases to the user's request. Pass along everything the user provided after
`/zensu-bootstrap` (the vision/plan document, flags) as the skill's input. Do not summarize or
skip the skill — follow it verbatim.
