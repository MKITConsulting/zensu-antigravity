# Zensu PLM — Conventions

Zensu PLM active — run `/zensu-help` for orientation. This workspace uses the
zensu-antigravity plugin: the typed `zensu` CLI, the `/zensu-*` workflows, and the
`zensu-*` subagents. Zensu makes **features first-class citizens** across the whole
lifecycle — from roadmap to release.

## Core model

- **Products** own **Components** (domain modules), **Tiers** (pricing levels with
  feature gating), **Features** (the central entity), and **Journeys** (critical user
  paths).
- **Feature IDs** are `KEY-N` (product key + per-product number, e.g. `ZEN-42`). Reference
  them in commits as `[ZEN-42]`; legacy `[ZEN-<slug>]` refs stay resolvable.
- **Lifecycle:** `planned → in-progress → testing → released`, gated by the **security
  score** (0–10), **docs completeness**, and **journey health**.
- A feature fans out along two per-feature axes (distinct from the product roadmap):
  **revisions** (build-out stages over time; v1 is the baseline) and **subfeatures**
  (structural child parts sharing the parent's component + release).

## Routing rule

Route **any** product/feature/roadmap interaction — and any `zensu` CLI work — through
the **`zensu-plm`** subagent (or the matching `/zensu-*` workflow), never raw CLI calls on
the main thread. On a product-planning request, run the project-context triage first:
ask (1) is code already built, (2) is there a plan/vision doc, (3) does the plan describe
not-yet-built items — then route greenfield → `/zensu-bootstrap`, brownfield →
`/zensu-ghost-scan`, hybrid → ghost-scan then `zensu features create --status planned` for
the unbuilt remainder. The triage is journey-aware: brownfield imports need journeys to
pass the release gate. State-mutating `zensu` commands are gated outside a workflow (see
`zensu-write-gate.md`); reads run freely.

## Discipline pointers

- **Never guess feature IDs** — run `zensu features list` or ask the user.
- **Set the security classification before coding** a feature.
- **Status changes** use `zensu features status <id> <status>`, never `zensu features update`.
- **Ground new work in existing knowledge** — `zensu knowledge search` before planning or
  implementing.
- Plugin behavior is tunable via `~/.zensu/config.json`.

## Invocation & context

- `/zensu-help` lists everything; `/zensu-tdd` runs the gate-enforced (or vanilla)
  TDD build. Workflows are the user-facing trigger — type `/zensu-<name>`.
- **When the context window gets large** (heading past roughly half full), proactively
  propose `/compact` to the user so the session stays responsive. Never compact on your
  own — only the user can — and never block on it.
