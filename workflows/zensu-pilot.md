---
name: zensu-pilot
description: Guide a tracked Zensu feature through the delivery pipeline step by step (probe, offer, delegate, transition). Load and execute the `pilot` skill.
---

# /zensu-pilot

Load and execute the **`pilot`** skill (`skills/pilot/SKILL.md`) in full, applying all of its
phases to the user's request. Pass along everything the user provided after `/zensu-pilot`
(feature ID, flags) as the skill's input. Do not summarize or skip the skill — follow it
verbatim.
