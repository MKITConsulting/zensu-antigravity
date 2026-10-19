---
name: zensu-self-review
description: Load and execute the bundled self-review skill with the current session binding.
---

# /zensu-self-review

Load `skills/self-review/SKILL.md` from this plugin installation and execute it in full.
Forward every user-supplied argument unchanged. Follow its host execution contract and
use the session-bound helper prefix injected by the plugin. Never infer a session id
from a directory, timestamp or another conversation.
