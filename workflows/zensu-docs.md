---
name: zensu-docs
description: Author genuine, code-grounded per-feature documentation for a Zensu feature (or a whole product in one batch), link it, and verify the docs_complete gate flipped. Load and execute the `docs` skill.
---

# /zensu-docs

Load and execute the **`docs`** skill (`skills/docs/SKILL.md`) in full, applying all of its
phases to the user's request. Pass along everything the user provided after `/zensu-docs`
(the feature id or product id, flags) as the skill's input. Do not summarize or skip the
skill — follow it verbatim.
