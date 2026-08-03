---
name: zensu-setup
description: Interactive first-run configuration for the Zensu plugin (install check, auth, curated settings, deep-merged config write). Load and execute the `setup` skill.
---

# /zensu-setup

Load and execute the **`setup`** skill (`skills/setup/SKILL.md`) in full,
applying all of its phases to the user's request. Pass along everything the user
provided after `/zensu-setup` (`--global`, `--project`) as the skill's input. Do not
summarize or skip the skill — follow it verbatim.
