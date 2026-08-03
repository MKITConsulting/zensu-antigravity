---
name: zensu-wargame
description: Wargame a hard mission into an executable-blind battle plan — moves, expected observations, likely failures, triggered forks, RECON NEEDED, abort conditions, verification, red-team pass. Load and execute the `wargame` skill.
---

# /zensu-wargame

Load and execute the **`wargame`** skill (`skills/wargame/SKILL.md`) in full, applying all of
its operating procedure to the user's request. Pass along everything the user provided after
`/zensu-wargame` (the mission, a template name, a `/goal` contract line, an output path) as
the skill's input. Do not summarize or skip the skill — follow it verbatim.
