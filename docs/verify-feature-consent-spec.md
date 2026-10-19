# Verification consent boundary

The canonical policy modules remain `hooks/lib/verify-consent-v1.js`, `verify-navigation-floor-v1.js`, and `scripts/verify-browser-config.js`. Host payload/verdict translation is confined to `hooks/antigravity/`.

A navigation must use an approved origin, exclude credentials and query/fragment data where the canonical floor requires it, and stay within the validated network policy. Network-only origins are not navigable evidence targets. Remote targets must be public HTTPS and pass address validation. The supported evidence mode is `declared-safe`; a generic redaction guarantee is not offered. WebSocket fencing remains a documented browser-driver gap.

The host hook contract documents ask/force_ask, and the adapter emits its native verdict. Do not infer a successful approval or navigation from an absent field, an attempted call or a textual model assertion. Permission-mode context, exact session/origin and successful post-tool observation must meet the canonical receipt checks. If the host cannot provide them, navigation fails closed; an externally supplied validated `ZENSU_VERIFY_NAVIGATION_POLICY_V1` policy is the supported alternative. The agent never installs that policy into writable project configuration or answers a user prompt on the user's behalf.

The complete interactive approval and result-receipt cycle is unverified on this native CLI. Deterministic policy tests and live ask-dialect delivery are narrower claims. Detailed recipes and refusal handling are in `skills/verify-feature/rules/browser-verification.md` and `setup.md`.
