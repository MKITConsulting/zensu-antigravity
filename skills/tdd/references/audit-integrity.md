# Audit integrity and recovery

Read this entire reference before Phase 6 step 5b or any self-review audit retry. A
successful shell exit, green tests or withdrawal prose cannot replace a clean, fresh receipt.

Use the injected `{session-helper}` for this conversation and retain the inner explicit
`--session "{conversation_id}"` on every workflow audit, even though the outer helper is
session bound. The native resolver requires this acknowledgement before grading or writing.
On a missing operand, follow the safely quoted recovery command it prints for the bound
project, log and session; do not override ambient selectors, change project, disable the
receipt or select another output. `--inventory` is read-only. Standalone inspection outside
an active workflow is noncanonical and cannot complete one.

The canonical receipt retains the original baseline, cumulative dirty scope, append-only
claim identities and current snapshots for this session/generation/log. Reuse that context:
omitting `--dirty-before` cannot clear its cumulative dirty paths. A failed first proof or
Git fault also preserves scope and invalidates any formerly clean verdict. Resolve the
actual fault, then retry. Do not edit, delete or replace the log, receipt or scope to remove
a pending claim. Ordinary append-only non-claim log entries do not invalidate a fresh
receipt; added claims, rewritten/truncated history, changed source or another generation do.

For a landed dirty claim, add `--predicates <JSON file>` to the exact audit command. Use
native file-edit operations to write bounded data with this shape:

```json
{
  "schema": "edit-landing-predicates-v1",
  "claims": [{
    "step": "R1-S1",
    "path": "src/invoice.js",
    "sha256": "<actual current lowercase SHA-256 of the complete file>",
    "present": ["<literal required current implementation>"],
    "absent": ["<literal previous implementation>"]
  }]
}
```

Compute the hash from bytes actually read, for example with Node's
`createHash('sha256').update(fs.readFileSync(file)).digest('hex')`. This is a bounded data
proof, never executable code: do not add commands, callbacks, regular expressions or
arbitrary extra fields to a proof. At least one nonempty literal in `present` or `absent`
must assert the claimed change; false literals, wrong hashes and empty predicates fail.
Use exact repository-relative regular-file paths; traversal, symlinks and unsupported
files are rejected. Cover every historical and new claim label for a repeatedly changed
file when each remains pending. For an actual supported deletion, the proof is
`{"step":"R1-S1","path":"src/removed.js","missing":true}` and must match current absence.

Re-read the resulting verdict. Only genuinely satisfied current predicates resolve a dirty
claim. Preserve the existing zero-change, non-Git and gitignored-artifact rules; no new
proof or annotation fabricates an exemption. An unresolved claim leaves the chain open.

After the one legitimate self-review fix, refresh audit proofs and the full-suite/scoped-CI
record, then refresh affected acceptance records on the final tree. Call the actual
ticket-bound `--chain-done` terminus only after all required evidence is current. Its audit
refusal names the recovery command; follow it with current proofs and refresh stale
acceptance evidence. Never start a new generation merely to avoid this refusal.
