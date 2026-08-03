---
name: zensu-doctor
description: Read-only setup diagnostics for the Zensu plugin (CLI and tooling, plugin integrity, config, session state). Load and execute the `doctor` skill.
---

# /zensu-doctor

Load and execute the **`doctor`** skill (`skills/doctor/SKILL.md`) in full,
applying all of its phases to the current worktree. Pass along everything the user
provided after `/zensu-doctor` as the skill's input. Do not summarize or skip the
skill — follow it verbatim.
