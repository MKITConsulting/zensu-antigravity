---
name: zensu-ghost-scan
description: Scan an existing repository for undocumented features and import them into Zensu as tracked features. Load and execute the `ghost-scan` skill.
---

# /zensu-ghost-scan

Load and execute the **`ghost-scan`** skill (`skills/ghost-scan/SKILL.md`) in full, applying
all of its phases to the user's request. Pass along everything the user provided after
`/zensu-ghost-scan` (product ID, repo path, flags) as the skill's input. Do not summarize or
skip the skill — follow it verbatim.
