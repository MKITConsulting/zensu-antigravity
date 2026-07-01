---
name: zensu-pulse
description: Your developer journal — privacy-first session tracking that records session boundaries and which features you touch. Load and execute the `pulse` skill.
---

# /zensu-pulse

Load and execute the **`pulse`** skill (`skills/pulse/SKILL.md`) in full, applying all of its
phases to the user's request. Pass along everything the user provided after `/zensu-pulse`
(session ID, flags) as the skill's input. Do not summarize or skip the skill — follow it
verbatim.
