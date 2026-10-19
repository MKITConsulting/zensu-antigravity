
### Phase 5: Journey Discovery & Creation

User journeys are a release gate (journey health), yet a brownfield import never gets
them — close that gap here, **after `zensu ghost apply`**, when features have real ZEN IDs.
This mirrors `/zensu-bootstrap` Step 2.

**Scope gate — single- vs multi-component product (decide FIRST).**
- **Single-component product**, or you just scanned the **last remaining** component of a multi-component one: run this per-component Phase 5 now — the whole feature set exists, so journeys can span it.
- **One component of a multi-component product with others still unscanned:** do NOT create journeys here. A per-component pass only saw THIS repo, so it can only build component-local journeys — but the highest-value journeys are **cross-component** (e.g. landing → frontend register → backend auth → wiki hand-off), and their downstream features do not exist yet. Instead: keep the Phase 2b draft journeys as raw material (note where you saved them), `log` that journey creation is deferred, and run **Phase 5b** once every component is scanned. Journey health is not required by the default release gate, so deferring blocks nothing.

1. Build a slug → **feature UUID** map from the just-applied features. Run
   `zensu features list --product <product-id> --json`; when its `total` exceeds
   the returned `data` length (the endpoint pages at 20 and the CLI exposes no
   page flag), build the map from `zensu journeys suggest --product <product-id>`
   instead, whose `features` array carries the whole catalog. A partial map
   silently drops journey steps, so verify the map size against `total` before
   continuing. The steps below need the UUID — `feature_id` is a UUID FK and a
   slug is rejected.
2. Take the draft journeys consolidated in Phase 2b. Resolve each draft step's
   candidate slug to a real `feature_id` via the map. Drop any step whose slug was
   rejected or not applied, and `log` what was dropped (no silent omission).
3. Dedup against the existing journeys loaded in Phase 1 — do not re-propose a
   journey that already exists.
4. Present the proposed journeys as a table (title, persona, ordered steps →
   features). The user edits/approves before creation.
5. On approval, mirror the bootstrap mechanic:
   - `zensu journeys suggest --product <product-id>` for product context.
   - `zensu journeys create --product <product-id>` per approved journey
     (`--title` required, `--slug`, `--type` ∈ critical|happy_path|edge_case|error_path|onboarding,
     `--priority` ∈ critical|high|medium|low, `--persona` free text). Use only
     those `--type` values — the server rejects anything else.
   - `zensu journeys step <journey-id> --product <product-id>` per step (`--step-order` 1-based,
     `--feature` = the feature **UUID** from the map, never a slug,
     `--interaction-type` ∈ action|navigation|input|validation|output|wait,
     `--critical`).
   - `zensu journeys health --product <product-id> <journey-id>` on each created journey; report weak links to the user.

> **Build-out baseline (automatic, server-side).** Each newly created feature is
> seated at a `v1` "Discovered baseline" automatically by the scan apply — minted
> server-side, no client step here. Older servers simply have no baseline;
> harmless. Features fan out later into deeper revisions
> and subfeatures.

### Phase 5b: Cross-Component Deep Journey Pass (multi-component products)

Run this ONCE, after **every** component of a multi-component product has been scanned + applied (so all features exist). It replaces the per-component Phase 5 for such products. Rationale: a single metadata pass over feature titles yields plausible-but-unverified journeys; real cross-component journeys must be **traced through the actual code and the existing E2E specs**, then cross-checked adversarially. Read `{plugin_root}/docs/native-reviewers.md` and dispatch the discovery lenses as distinct `zensu-plm` advice children, then fresh skeptic/completeness children. Collect actual protected results and synthesize in this conversation.

**A — Explore (native read-only lenses).** Each lens reads the whole repo set + the full feature catalog and proposes 2-5 candidate journeys. **Every step must be grounded in a REAL catalogued feature slug plus a concrete code/test evidence string** (a route/handler, a CLI verb, a UI nav target, an event/webhook, or a test that exercises the transition). Core lenses:
- **entry-points** — routes/controllers, CLI verbs, UI nav, MCP tools, webhooks → where journeys start + the real step-to-step transitions.
- **test-derived** (highest signal) — read the existing E2E specs + flow tests; they already encode real, team-validated user journeys. Reconstruct each onto catalogued slugs, citing the spec + test name.
- **data-flow** — trace writer→reader across components (e.g. agent heartbeat POST → backend ingest → frontend dashboard) for genuine sequential dependencies.
- **cross-component-bridge** — session hand-off, deep-links, shared auth/redirects → the seams that let a journey cross a component boundary.
- **persona lenses** — one per persona (new-user/admin, developer/API consumer, security-engineer/SRE) → that persona's end-to-end path.

**B — Consolidate + adversarially verify.** Merge/dedupe the candidates into a master list (collapse overlapping step-sets, keep distinct personas). Then, per master journey, dispatch a fresh **skeptic** native advice child that tries to REFUTE each step transition against the code: it must find evidence that in the running product an actor genuinely moves from step k to step k+1 (a nav link, a returned id consumed by the next call, an event, a test doing exactly this). **Trim unevidenced steps, or split the journey, rather than fabricate a link.** A completeness critic names the personas/paths/components left uncovered.

**C — Synthesize + create.** Emit the final evidenced journeys — carry each step's code/test citation into the step `--description` so the evidence lives in Zensu. Present the table for user approval, then create via the Phase 5 step-5 mechanic (`journeys create` / `journeys step <id> --feature <UUID>` / `journeys health`). **Real catalogued slugs ONLY** — never invent one; if a wanted step has no catalogued feature, record it as a gap.

Discipline: ground every step in code, prefer ≥2 components per journey, and honestly leave a component uncovered (with a logged reason) rather than forcing an invented cross-component step. Journey-health scores reflect the underlying features' readiness (docs + security), not the wiring.

### Phase 6: Summary & Next Steps

1. List created features via `zensu features list --product <product-id> --json` (no `--compact` flag; the response pages at 20, so report the envelope's `total` rather than the length of `data`).
2. Report counts: features created/enriched, tests linked, docs linked, journeys
   created, and journey-health weak links from Phase 5.
3. **Doc-gap report.** List the created/enriched features with zero docs (empty
   `detectedDocFiles`). Recommend `/zensu-implement` to author code-grounded docs
   for them — ghost-scan links existing docs but never generates new ones
   (`docs/documentation-guide.md`).
4. Recommend next steps:
   - `/zensu-implement` for feature implementation
   - `/zensu-security-review` for a deep security review (threat model, pentest, data-sensitivity, auth/encryption posture) — the scan already set and persisted each feature's baseline `securityClassification` at apply, so this is the follow-up that hardens it, not where classification first happens
   - `zensu doc claude-md` for an updated AGENTS.md
5. **Hybrid — capture planned-but-unbuilt features.** If the repo also has a
   forward-looking plan/vision doc, diff it against the features just created. For
   each plan item with no matching feature, run `zensu features create` with `--status planned`
   — these are genuinely unbuilt (no v1 baseline yet; they get one at
   implement-time). This completes the "built + planned" picture that neither a
   pure scan nor a pure bootstrap captures alone.

## CLI Commands Used

| Command | Phase | Purpose |
|---------|-------|---------|
| `zensu products list` | 1 | Validate product |
| `zensu features list` | 1, 5, 6 | Load existing features (dedup); resolve slug → feature UUID after apply. Pages at 20 — fall back to `journeys suggest` for the full catalog |
| `zensu journeys list` | 1, 5 | Load existing journeys (dedup) |
| Native file-reading tools | 2b | Sequential read-only analysis lenses |
| `zensu ghost scan` | 3 | Create scan with candidates |
| `zensu ghost candidates` | 1 (resume), 4 | Load candidates |
| `zensu ghost batch` | 4 | Batch approve/reject candidates in one call |
| `zensu ghost apply` | 4 | Apply approved candidates (use `--enrich-existing` if product has features) |
| `zensu journeys suggest` | 1, 5 | Product context for journey suggestions; also the only CLI path to the unpaginated feature catalog |
| `zensu journeys create` | 5 | Create a discovered journey |
| `zensu journeys step` | 5 | Add ordered steps linking real feature UUIDs |
| `zensu journeys health` | 5 | Report weak links on created journeys |
| `zensu features create` | 6 | Hybrid: create planned-but-unbuilt features from a forward plan doc |
| `zensu doc claude-md` | 6 | Update AGENTS.md (optional) |
