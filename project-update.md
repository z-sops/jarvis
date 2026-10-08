# Orbit / Jarvis + NeuralOps — Project Update

Last updated: 2026-10-08 (Asia/Karachi)

## Working agreement

- Strengthen the existing Orbit and NeuralOps systems; preserve the product vision and reuse existing capabilities.
- Explain each gap, proposed adjustment, benefit, impact and verification before implementation. Obtain specific approval before applying that change.
- Respond in Roman Urdu / English.
- Maintain this file after each meaningful investigation, decision, approved change and verification. Never record credentials or personal data.
- No dependency installation, paid calls, destructive operations, production database changes, deployment, commits or pushes without applicable authorization.
- This log is being added to the Orbit review branch with the first identity change. The user's Windows checkout has not been changed.

## Product requirements discussed

- Visual AI office with Laila as CEO and dynamically configured workers.
- Laila evaluates scope, plans work, selects roles/skills, delegates, monitors and verifies deliverables.
- Direct worker dispatch through commands such as /alex and /bob.
- Shared procedural skill library and knowledge packs; job-specific context selection.
- Structured Alex-to-Bob development/testing handoffs with evidence and clear ownership.
- Guidance controls for approvals, state protection, cross-tag context and economy.
- State-preserving compaction and continuity across provider/model changes.
- Worker observability: meaningful progress, activity, tool status, tokens, errors and retries.

## Completed investigation

### Orbit read-only review

- Repository: https://github.com/z-sops/jarvis
- Inspected revision: 064e735351885030d4864ff23ca3881d7c72827f.
- Reviewed repository structure and execution/security/reliability paths; produced Orbit-Jarvis-Read-Only-Audit.md with 27 findings.
- Relevant source implementations were inspected; tests were not executed.
- No source modifications, installations, model calls, production writes, commits or pushes were performed.

### Screenshot review

- Viewed all nine supplied screenshots successfully despite the initial attachment path errors.
- Observed Office, workers, Workspace, Browser, Connectors, Memory, Library and Settings.
- The interface reported NeuralOps connected with 42 tools. This establishes displayed connection status, not end-to-end enforcement.
- Memory displayed five personal skills; shared Library displayed zero skills and one knowledge pack. These are different collections.
- Screenshots alone do not verify worker performance or the correctness of generated files.

### NeuralOps core and Orbit integration review

- Repository: https://github.com/z-sops/neuralops
- Inspected revision: decd1cbd19caebfbaf4a645324ee496a0d27d1bc; MCP package version 0.1.6.
- Inspected task manager, context engine, authority, gates, identity, MCP registry/transport, journal/replay, configuration, hooks and selected test source.
- Compared Orbit connectors, gateway and upstream transport against NeuralOps identity handling.
- Found actual implementations for 28 typed acts / 42 tools, task ownership, handoff accept/reject, approvals, reservations, structured compaction, ledger, signed journal/replay and workspace freeze.
- Classification: implemented but unverified in this session. No tests or live service calls were run.
- Correction to earlier scope: guidance/state/compaction capabilities exist in the separate NeuralOps repository; they must be assessed together with Orbit. Their availability does not establish mandatory Orbit enforcement.

## Findings and proposed strengthening

| ID | Gap found through code inspection | Proposed adjustment | Benefit | Status |
| --- | --- | --- | --- | --- |
| N01 | Orbit uses one saved connector token; upstream ignores the actor option and does not send delegated worker identity. | Map each worker to a NeuralOps identity and use its existing broker/delegate mechanism; reject missing/revoked mappings. | Correct ownership, actor history and separation of permissions. | Implemented on the review branch; 17 focused checks pass. Real-service verification and upstream actor-authentication hardening remain pending. |
| N02 | Inspected Orbit gateway does not automatically require NeuralOps clearance before other connector actions. | Enforce relevant checks in actual execution paths and synchronize Orbit jobs with NeuralOps tasks. | Guidance applies consistently instead of depending on model cooperation. | Proposed; scope and approval pending. |
| N03 | gateStatus for non-completion actions accepts approved status without checking expiry or consumption. | Use consistent approval usability checks and review clearance semantics. | Expired/exhausted permissions do not clear future actions. | Static finding; fix and verification pending. |
| N04 | Journal write exceptions are logged and swallowed while live state may already change. | Propagate persistence failures and design safe state/acknowledgment handling. | Avoid reporting an operation as durably saved when disk persistence failed. | Static finding; design and approval pending. |
| N05 | Verified evidence is assigned from producer attest authority; it is not automatic artifact inspection. | Connect trustworthy QA/CI evidence to acceptance criteria and artifact versions. | Completion requires appropriate evidence of the requested result. | Integration proposal pending. |
| N06 | Compactor estimates tokens from characters and summarizes stored state; this is not provider usage/budget telemetry. | Keep estimates labeled; connect actual provider metrics and budget controls separately. | Honest economy reporting and enforceable limits. | Proposal pending. |

## Evidence pointers

- NeuralOps task states and handoffs: mini-services/neuralops-mcp/src/engines/task-manager.ts
- Compaction: mini-services/neuralops-mcp/src/engines/context.ts
- Approval usability: mini-services/neuralops-mcp/src/engines/authority.ts
- Gate inconsistency: mini-services/neuralops-mcp/src/engines/gate.ts
- Token/broker identity: mini-services/neuralops-mcp/src/server/identity.ts
- Persistence failure handling: mini-services/neuralops-mcp/src/engines/replay.ts
- Orbit connection/actor forwarding: lib/connectors.js, lib/gateway.js, lib/upstream.js

## Approval and execution state

- User authorized read-only NeuralOps inspection with 'check karlo'.
- User agreed to strengthening rather than replacing the system.
- After the concrete N01 proposal, the user said 'carry on working aur isko add bhi kardena', authorizing this implementation and adding the log to the repository on a review branch.
- User authorized creation and ongoing maintenance of project-update.md.
- N01 downstream identity forwarding is implemented and covered by focused offline checks. This does not establish full end-to-end identity isolation: Orbit's existing shared gateway bearer/actor URL authentication remains an independent audit finding (F02). No real-service, Windows or full-suite pass is claimed.

## Change history

| Date | Activity | Result / verification |
| --- | --- | --- |
| 2026-10-08 | Orbit read-only review and audit report | Source inspection; runtime behavior unverified. |
| 2026-10-08 | Nine screenshots reviewed | Visible setup understood; live execution not verified. |
| 2026-10-08 | NeuralOps core and Orbit connector reviewed | Existing guidance implementation confirmed in source; six strengthening areas documented. |
| 2026-10-08 | N01 worker identity proposal explained | Benefits and intended verification explained; approval pending. |
| 2026-10-08 | project-update.md created | Investigation, requirements, findings and pending approval recorded; repository unchanged. |

## Implementation record — N01

- Added lib/neuralops-identity.js: explicit unique AI identity mappings, malformed/header-injection rejection, no human identity assignments, and fail-closed missing mappings.
- Updated lib/connectors.js: validated mapping persistence, broker setup guidance and configuration signatures that change with mappings.
- Updated lib/upstream.js: identity-bound X-Agent-Id header alongside the private broker bearer token.
- Updated lib/gateway.js: separate connections/cache entries per mapped identity, no fallback to a shared actor, changed-access checks after approval and connector-wide cleanup of identity connections.
- Updated lib/connectors-panel.js and renderer/js/connectors-ui.js: editable mappings for Laila and each worker under Who can use it; validation errors shown; saved tokens never returned to the renderer.
- Added test/neuralops-identity.test.js and included it in the default test script. Updated README.md and AGENTS.md with setup and verification limitations.
- Existing NeuralOps authority, worker allowlists and Orbit tool-level approvals were preserved. No server registration or authority change was performed.
- Existing installations need an Orbit broker plus separately registered AI identities with that broker as delegate. Workers without mappings cannot use the NeuralOps connector until configured.
- Approval-granting calls still run as the mapped AI identity, after Orbit's existing user dialog; human approvals remain in NeuralOps' human workflow. This change does not impersonate a human or add human-decision attribution.

## Verification — 2026-10-08

- node --check: all seven changed/new JavaScript files passed.
- node --test --test-isolation=none test/neuralops-identity.test.js test/neuralops-connector.test.js: 17 passed, 0 failed, 0 skipped (Node 24.19.0).
- Checks cover parallel identity headers, missing mappings, unsafe/duplicate/human mappings, simulated delegate revocation, mapped handoff boundary, approval/allowlist preservation, mapping changes during approval, stale connection cleanup, unchanged other-service headers/native actor forwarding, IPC and DOM form behavior.
- First focused run: 14 passed / 1 failed due to a test fixture missing its connector visibility setting. Fixture corrected; subsequent 17-check runs passed. No product failure was hidden or waived.
- Tests used an in-memory MCP client substitute and a DOM harness. No test sockets, temporary test files, child worker processes or paid model calls were used.
- No dependencies were installed. Full npm test was not run: the available checkout is a scoped source snapshot, and the full suite contains filesystem/process/integration tests subject to the user's restrictions. Real MCP SDK transport, live NeuralOps/Hermes, real server handoff semantics, visual Electron screenshots and Windows execution remain unverified.

## Remaining boundaries and next proposals

- F02: the upstream Orbit MCP door still uses a shared bearer plus caller-selectable actor URL; this patch does not make that ingress authentication identity-bound. Thus downstream actor forwarding is strengthened, but malicious-worker impersonation is not yet fully solved.
- N02-N06 remain proposed, not implemented: mandatory NeuralOps gating, approval gate expiry/consumption, journal failure propagation, evidence integration and actual economy telemetry.
- OpenCode and built-in workers gain no new connector access in this change.
- Next: explain strengthening the Orbit actor-authentication boundary, including the change and benefit, before requesting the next specific approval.


| 2026-10-08 | User authorized N01 implementation and repository addition | Scope limited to identity forwarding and its setup/tests/log. |
| 2026-10-08 | N01 implemented and offline checks completed | 17 focused checks and 7 syntax checks passed; live/full-suite verification pending. |
