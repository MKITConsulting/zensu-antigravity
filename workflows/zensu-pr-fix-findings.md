---
name: zensu-pr-fix-findings
description: Fix every open review comment / finding on a GitHub or GitLab pull/merge request end-to-end — triage, implement via the Zensu workflow, push, resolve the threads. Load and execute the `pr-fix-findings` skill.
---

# /zensu-pr-fix-findings

Load and execute the **`pr-fix-findings`** skill (`skills/pr-fix-findings/SKILL.md`) in full,
applying all of its steps to the user's request. Pass along everything the user provided after
`/zensu-pr-fix-findings` (an optional PR/MR URL or number) as the skill's input. Do not summarize or skip
the skill — follow it verbatim.
