# Contributing to the Zensu Antigravity Plugin

Thank you for your interest in contributing! This guide will help you get started.

## Reporting Bugs

Use the [Bug Report](https://github.com/MKITConsulting/zensu-antigravity/issues/new?template=bug_report.md) issue template. Include:

- Steps to reproduce the issue
- Expected vs. actual behavior
- Your environment (OS, Antigravity / `agy` CLI version, plugin version, shell)

## Suggesting Features

Use the [Feature Request](https://github.com/MKITConsulting/zensu-antigravity/issues/new?template=feature_request.md) issue template. Describe the problem you're trying to solve and your proposed solution.

## Security Vulnerabilities

Do **not** open a public issue. Instead, email [security@zensu.dev](mailto:security@zensu.dev). See [SECURITY.md](SECURITY.md) for details.

## Pull Requests

**External pull requests are not accepted.** This repository is published as a read-only source. Forking is disabled and only maintainers of the `MKITConsulting` organization can merge changes into `main`.

If you would like to see a change, please open an issue describing the problem or feature. The maintainer team triages incoming issues and implements accepted changes internally.

Any pull request opened against this repository will be closed without review. This policy keeps the release pipeline reproducible and ensures every change is covered by the project's licensing and review process.

## Local Development Setup

You are welcome to clone and run the plugin locally for evaluation or learning purposes, subject to the [LICENSE](LICENSE):

```bash
git clone https://github.com/MKITConsulting/zensu-antigravity.git
cd zensu-antigravity
bash install.sh          # stage the plugin into the Antigravity IDE + CLI plugin paths
export ZENSU_API_KEY=zsk_...
```

Restart Antigravity so the freshly staged plugin (rules, agents, skills, hooks) loads.

## Running the Tests

The deterministic test gate runs offline (no network, no API):

```bash
bash tests/run-all.sh
```

It runs the `tests/structure/test-*.sh` suite and the `evals/config-gate/run-eval.sh --self-check` offline matrix. Run it before opening any internal change.

## Code Standards (Internal Reference)

The following standards apply to maintainer commits:

- **No comments in code** — code should be self-explanatory
- **Conventional Commits** — use prefixes like `feat:`, `fix:`, `chore:`, `docs:`
- **Skills** — follow the existing phase-based workflow pattern (see `skills/bootstrap/SKILL.md` for reference). Each skill ships YAML frontmatter (`name:` + `description:`) and is invoked through its `/zensu-<name>` workflow.
- **Agents** — follow the structure of `agents/zensu-plm.md` (decision rules, tool references, important rules). The two reviewer agents (`zensu-code-reviewer`, `zensu-review-aspect`) declare a write-free `tools:` list.
- **Hooks** — engine-neutral hook scripts stay byte-aligned with upstream `zensu-claude-code`; Antigravity-specific translation lives only in `hooks/antigravity/antigravity-shim.sh`. Use `bash -c` with proper error handling and `2>/dev/null` for optional commands.

## Licensing

This project is licensed under the [Functional Source License, Version 1.1, Apache 2.0 Future License](LICENSE) (FSL-1.1-Apache-2.0).

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code.
