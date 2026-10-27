# Native agent delegation validation

Date: 2026-10-27. Candidate: 0.4.2. Host: Antigravity CLI 1.4.7.
Model: Gemini 4 Argon medium, selected for this process only.

## Reproduced host incompatibilities

An unmodified 0.4.1 package failed in native parent
`e5fbe2c9-cc70-4c0b-890a-1f5125cfdfaf`:

- The host accepted flat `TypeName`, `Role`, `Prompt`, `Model`, `Workspace`
  arguments, which the old adapter rejected because it required `Subagents`.
- The alternative batch call was rejected by the host schema before the hook:
  missing `TypeName`, `Role`, `Prompt`; additional property `Subagents`.

After accepting flat descriptors, parent
`23f23e6c-a0bb-4615-a00b-6b01474c0c37` started two actual children. Its launch
results used `Created the following subagent:` (singular). Both host sidecars
reported step 4, although the first child's actual completed result was step 3.
The earlier parser expected the plural result and an exact sidecar step.

The adapter now supports both observed argument/result forms. Mixed formats
are refused. For the observed multi-call sidecar drift, it requires the child's
unique UUID in a completed parent result, its exact descriptor at the matching
planner offset, distinct roles, only flat native dispatch calls, and the final
step of that same planner response. The accepted receipt, exact prompt, role,
workspace, runtime, source tree and normal child Stop are still required.
Arbitrary index drift, changed descriptors, duplicate children, nested launches
and model/workspace overrides remain denied.

## Completed native proof

The frozen candidate produced:
`NATIVE-AGENTS-VERIFIED READONLY-DENIAL-HONORED` (process exit 0).

- Parent: `f7c797cf-e6f4-4951-ae36-638485a9d940`.
- Left child: `b58e01a8-62c2-4b8e-a41c-136e7d623be7`.
- Right child: `4e6addc8-dcb1-4a28-8784-4bf36a0b29ea`.
- Fixture tree: `e5bd72b9182e9da8bdee6de98be0ce29f0850663`.
- Tested runtime digest before this validation document was added:
  `sha256:e9c689979edf91e4da87c86ab27326a70790c7f8148c0e44fd4e165de960710f`.

Both actual children read their distinct synthetic markers and returned the
matching raw JSON. Both produced protected fully-idle `NO_TOOL_CALL` Stop
receipts. The left child's attempted read through a symlink into synthetic
`.zensu/state` was denied by the real reviewer capability gate; it did not
bypass that denial. The source tree, symlink and protected bytes stayed intact.

The original frozen package was copied into a disposable project. No host or
hook payloads, child identities, completion receipts or API replies were
fabricated. No broad permission bypass was enabled. All staged files and four
global configuration files were byte-identical after the run. No human result
acceptance or revocation was performed.

The versioned native probe now accepts either one legacy batch or two distinct
current-host calls, still requiring exactly two real children and both protected
completion receipts. Its overall model-run budget is 600 seconds; the startup
hook's 90-second deadline is unchanged.

## Scope

This closes the native two-child delegation gap recorded in the 0.3.1 startup
validation. It verifies dispatch, child identity, read-only confinement and
normal completion. It does not certify every complete orchestration skill,
independent human judgment, a separate IDE host, or universal model reliability.
Deterministic CI and published-archive verification remain separate checks.
