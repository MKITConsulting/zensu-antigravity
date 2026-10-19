# Authentication

Zensu uses the installed typed `zensu` CLI. Check `zensu --help` and its authentication command before using an account. GitHub and GitLab operations use the detected forge driver (`hooks/lib/zensu-vcs.sh`) and the respective authenticated CLI. Do not print tokens, read credential stores, or mix a user's host subscription with API authentication.

Runtime verification follows `skills/autopilot/rules/auth.md` and `skills/verify-feature/rules/attach.md`. The user supplies secrets through the configured application environment or an interactive login. Agents verify authenticated behavior without collecting passwords. Native browser permission handling and parent-environment navigation policy are separate from application authentication.
