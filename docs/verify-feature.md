# Feature verification

`/zensu-verify-feature` verifies actual acceptance criteria against an existing feature or the current chain. Supported recipe families are browser, service/API, CLI, desktop and mobile. Load `skills/verify-feature/SKILL.md`, then the matching rule file in its `rules/` directory. Each criterion has a stable AC identifier, expected behavior, executed observation and pass/fail/partial verdict. Unavailable credentials, tools, devices or environment remain partial.

The chain mode obtains the verified project anchor through the session helper and records acceptance evidence with `--acceptance-record`. Multiline evidence uses the wrapper's `--stdin-file` transport. Re-read `--acceptance-status` after the last record. UI verification requires both data/behavior evidence and visual inspection; a passing screenshot or DOM query alone is insufficient.

The browser driver uses the repository's scripts and pinned playwright-cli compatibility check. Origins and network requests are constrained by the validated run configuration; application login and origin consent are distinct. Native ask/force_ask verdicts are documented and translated, but the complete interactive answer/success-receipt cycle is not yet live verified. Missing permission context or successful-result evidence fails closed; use a validated parent-environment policy where required. See `verify-feature-consent-spec.md`.

Desktop/mobile tools are used only if installed and observable. Native Antigravity has no implicit desktop ownership or Session Hub receipt authority. Never manufacture external receipts, invent browser/preview tools or claim a driver ran merely because its recipe exists.
