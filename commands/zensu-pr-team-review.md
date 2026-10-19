---
name: zensu-pr-team-review
description: Load and execute the bundled pr-team-review skill with the current session binding.
---

# /zensu-pr-team-review

Load `skills/pr-team-review/SKILL.md` from this plugin installation and execute it in full.
Forward every user-supplied argument unchanged. Follow its host execution contract and
use the session-bound helper prefix injected by the plugin. Never infer a session id
from a directory, timestamp or another conversation.
