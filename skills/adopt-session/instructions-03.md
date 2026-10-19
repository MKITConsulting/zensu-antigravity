## Response Style

Render both command outputs verbatim; they are already formatted. Name both
versions. Never summarize away a `workflow baseline` value other than `present`,
a `provenance` other than `recorded`, a non-zero `leases set aside`, a non-zero
`leases stuck`, or any `WARNING:` line the command prints — about the workflow
document or about the lease store. The ONE provenance value that is not a finding
on its own is `no-workflow-document` in the orphaned-project-root case: there the
command prints a NOTE rather than a WARNING, because the document lived under a
directory that is gone and there is nothing to rebuild into. Report that NOTE;
do not upgrade it to the rebuild recommendation, which is for the other shape.
After a successful adoption, do not tell the user to restart — and when the
recorded project root was gone, say that native file-write/edit tools stay denied,
and so does any Bash command the source-write gate can attribute as a write
while that opt-in gate is on (`hooks.bashWriteGate: true`), until it is re-created — read-only Bash and the diagnostics do run — rather than
reporting an unqualified success.
