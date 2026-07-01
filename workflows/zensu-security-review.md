---
name: zensu-security-review
description: Run a comprehensive security review for a Zensu feature (classification, analysis, tests, threat model, completion). Load and execute the `security-review` skill.
---

# /zensu-security-review

Load and execute the **`security-review`** skill (`skills/security-review/SKILL.md`) in full,
applying all of its steps to the user's request. Pass along everything the user provided after
`/zensu-security-review` (feature ID, flags) as the skill's input. Do not summarize or skip the
skill — follow it verbatim.
