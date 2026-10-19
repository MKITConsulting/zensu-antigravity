# Native distribution and Marketplace submission

The official Antigravity Marketplace is a Google-curated catalog. The documented catalog
identifier is `antigravity-plugins-official`; Google also supports local-directory and GitHub
plugin installation. This repository's source requires staging, so its raw GitHub URL is
not an equivalent installation target. No custom marketplace manifest is documented.

Sources checked on 2026-10-19:

- [Native Marketplace and submission link](https://antigravity.google/docs/marketplace?tab=cli)
- [Plugin structure](https://antigravity.google/docs/plugins?tab=cli)
- [Publisher interest form](https://forms.gle/2EX5RFYPoJe1UgxR9)

## Package contract

`bash package-native.sh <output-directory>` generates a native ZIP and its SHA-256 file.
The ZIP contains one `zensu/` directory, the installer's curated runtime inventory, and a
generated `hooks.json`. Its four command handlers resolve relative to the directory
containing `hooks.json`, as documented and live-verified on agy 1.4.2. All gates still run
through the single dispatcher. No runtime scripts or verdict dialects are rewritten.

Packaging requires a Git checkout, rejects untracked descendants, missing required entries
and symbolic links, verifies the exact hook event inventory, excludes development/runtime
state and refuses to overwrite output files.
It does not invoke agy or alter a user installation, configuration or plugin-root pointer.
The native adapters derive their root from their own installed files; the pointer is not
runtime authority. A fresh conversation records the actual native package's runtime digest.

The release workflow publishes both the original source ZIP and the native ZIP with a
combined `SHA256SUMS`. Before distributing a package, run the deterministic gate and the
live suite against the extracted, natively installed artifact. An accepted manifest alone
does not prove hook execution, rule loading or actual denial by the gates.

## Publisher intake

Status: **submitted on 2026-10-19; awaiting Google's review, not approved or listed**.
The Google form displayed its submission confirmation after the public documentation page
was verified. Submission is an expression of publisher interest, not Marketplace acceptance.
The repository remains private. The intake form does not require a public repository URL.
Do not change repository visibility as part of submission.

| Required field | Value |
|---|---|
| Email | integrations@zensu.dev |
| Company name | MK IT Consulting (Zensu) |
| Company primary website | https://zensu.dev |
| Primary contact name | Marcel Karras |
| Primary contact email | integrations@zensu.dev |
| Public support email | integrations@zensu.dev |
| Documentation URL | https://zensu.dev/antigravity/ |

Provider identity is published in [Zensu's imprint](https://zensu.dev/imprint/).

Submitted plugin description:

> Zensu brings feature tracking, implementation workflows, evidence checks, native agent
> review, security reviews and release-readiness gates to Google Antigravity. The standalone
> native plugin includes 32 skills and seven role profiles and connects to Zensu through its
> typed CLI. It runs directly in Antigravity, with session-bound authority and completion
> checks. Strict test-first implementation is optional; evidence and review remain required
> in an armed workflow. Native CLI behavior is verified on agy 1.4.2. IDE acceptance is a
> separate, unverified target. Package access and support: integrations@zensu.dev.

The public documentation was published in website release `www/v0.21.0` before submission.
Google controls acceptance and the final listing identifier; do not advertise a catalog
installation command before the listing has been confirmed in the native catalog.
