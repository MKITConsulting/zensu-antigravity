---
name: zensu-verify-feature
description: Live-verify an already-built feature against the local worktree or a deployed preview, with DOM/data, visual, console, and network evidence. Load and execute the `verify-feature` skill.
---

# /zensu-verify-feature

Load and execute the **`verify-feature`** skill (`skills/verify-feature/SKILL.md`) in full,
applying all of its phases to the user's request. Pass along everything the user provided after
`/zensu-verify-feature` (feature description, route, `--mode`, `--driver`, `--base-url`, other
flags) as the skill's input. Do not summarize or skip the skill — follow it verbatim.
