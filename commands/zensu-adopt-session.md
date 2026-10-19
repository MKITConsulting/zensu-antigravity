---
name: zensu-adopt-session
description: Load and execute the bundled adopt-session skill with the current session binding.
---

# /zensu-adopt-session

Load `skills/adopt-session/SKILL.md` from this plugin installation and execute it in full.
Forward every user-supplied argument unchanged. Follow its host execution contract and
use the session-bound helper prefix injected by the plugin. Never infer a session id
from a directory, timestamp or another conversation.
