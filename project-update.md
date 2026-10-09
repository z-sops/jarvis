# Orbit / Jarvis + NeuralOps — Project Update

Last updated: 2026-10-09 (Asia/Karachi)

## Working agreement

- Strengthen the existing Orbit and NeuralOps systems; preserve the product vision and reuse existing capabilities.
- Latest authorization (2026-10-08 UTC): user requested autonomous strengthening and code changes while away, without per-change permission, followed by Playwright testing. Record each gap, adjustment, benefit and verification. Earlier pause/read-only/per-change approvals are historical and superseded for this Jarvis work; no ZCode source files are to be copied into Jarvis.
- Respond in Roman Urdu / English.
- Maintain this file after each meaningful investigation, decision, approved change and verification. Never record credentials or personal data.
- No dependency installation, paid calls, destructive operations, production database changes, deployment, commits or pushes without applicable authorization.
- This log has been added to the Orbit review branch with the first identity change. The user's Windows checkout has not been changed.

- Current autonomous scope: publish reviewable changes to the existing draft Jarvis PR branch. No main merge, deployment, paid/live provider calls or production data changes. Dependency installation was previously rejected; the user explicitly approved it on 2026-10-09 and installation/SDK/Linux Electron verification subsequently succeeded.

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
| N01 | Orbit uses one saved connector token; upstream ignores the actor option and does not send delegated worker identity. | Map each worker to a NeuralOps identity and use its existing broker/delegate mechanism; reject missing/revoked mappings. | Correct ownership, actor history and separation of permissions. | Implemented on the review branch; 17 focused checks pass. Actor-authentication hardening follows in F02 below; real-service verification remains pending. |
| N02 | Inspected Orbit gateway does not automatically require NeuralOps clearance before other connector actions. | Enforce relevant checks in actual execution paths and synchronize Orbit jobs with NeuralOps tasks. | Guidance applies consistently instead of depending on model cooperation. | Execution paths inspected; staged N02-A proposal prepared. Implementation approval pending. |
| N03 | gateStatus for non-completion actions accepts approved status without checking expiry or consumption. | Use consistent approval usability checks and review clearance semantics. | Expired/exhausted permissions do not clear future actions. | Implemented for N03 with 12 focused offline regressions passing; full integration pending. |
| N04 | Journal write exceptions are logged and swallowed while live state may already change. | Propagate persistence failures and design safe state/acknowledgment handling. | Avoid reporting an operation as durably saved when disk persistence failed. | Implemented after specific approval; 13 persistence failure-injection checks pass. Real filesystem/integration verification pending. |
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
- N01 downstream identity forwarding is implemented and covered by focused offline checks. This does not establish full end-to-end identity isolation: F02 was subsequently authorized and strengthened as recorded below; filesystem isolation and live verification remain separate boundaries. No real-service, Windows or full-suite pass is claimed.

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

- F02: actor-bound gateway authentication is now implemented with focused in-memory verification. Credential theft through unrestricted local filesystem access remains outside this change.
- N02, N05 and N06 remain proposed: mandatory NeuralOps gating, artifact evidence integration and actual economy telemetry. N03 and N04 implementations and limitations are recorded below.
- OpenCode and built-in workers gain no new connector access in this change.
- N03 was subsequently authorized and implemented below. The next independent change needs its own gap/change/benefit explanation and approval.


## Repository publication

- User authorized N01 implementation and repository addition with 'carry on working aur isko add bhi kardena'.
- Repository branch: codex/strengthen-neuralops-identities.
- Implementation commit: 6cc9bfd54a4f0efa56ac1f7967079df412cc726c (11 changed files).
- Draft review PR: https://github.com/z-sops/jarvis/pull/1.
- project-update.md is committed on that branch. Main has not been merged or changed by this work; the Windows checkout has not been updated.
- A follow-up log-only commit records this publication. All source verification results remain as listed above; no live deployment or worker setup was performed.

## Implementation record — F02 (2026-10-08)

- User authorized the concrete worker-bound gateway token proposal with “go ahead”. Preserved the existing architecture and main-process Laila path.
- Added lib/gateway-auth.js: a fresh 32-byte private key, exclusive creation with mode 0600, fail-closed corrupt/unreadable key handling, exact active-worker checks and per-actor HMAC tokens with constant-time comparison. The old shared browser token is never used as key material.
- Updated lib/browser-mcp.js: actor-bound bearer authentication, no default commander route, reserved/unknown actor rejection and a discovery-only bridge-check identity. Existing Host/Origin protections remain. URL, header and tool-body spoofing cannot select another authenticated actor.
- Updated lib/browser-panel.js: per-worker token in the Hermes profile environment, private key absent from generated profiles; existing signatures refresh changed profiles. Probe discovery omits connector tools and all probe tool calls are rejected.
- Added test/gateway-auth.test.js to the default test script; updated existing real HTTP browser-mcp tests, README.md and AGENTS.md. No new dependencies.
- Verification: 24 focused checks passed (gateway auth 7 + identity/connector 17), 0 failures/skips; five changed/new JavaScript files passed node --check. Gateway/profile checks used memory-only HTTP and filesystem substitutes.
- Initial combined run had one test-harness assertion failure comparing an empty array across VM realms. Corrected that assertion to compare length; final 24 checks passed. No product failure was waived.
- No paid calls, dependency installs, real sockets, child workers, production database changes or deployment. Real HTTP tests, full suite, Electron UI, live NeuralOps/Hermes transport and Windows ACLs remain unverified.
- Activation requires updating the Windows checkout, stopping existing jobs and restarting Orbit; none of those actions have been performed here. Existing NeuralOps broker/delegate mappings from N01 still need configuration and live whoami verification.
- Boundary: workers with unrestricted local filesystem access can steal another profile token or the master key. Same-ID recreation reuses its token under the same key; removal refuses future requests but does not cancel in-flight actions. This change does not claim OS sandbox isolation.
- Publication target: existing review branch codex/strengthen-neuralops-identities and draft PR https://github.com/z-sops/jarvis/pull/1; main remains unchanged. Publication confirmation follows after successful branch update.

### F02 publication confirmation

- Implementation commit: c00d8e7afa095a34e3fea245e1e1e542f8a4ee41 (nine changed/new files). Branch update succeeded.
- Draft PR #1 now describes both NeuralOps identity forwarding and worker-bound gateway authentication: https://github.com/z-sops/jarvis/pull/1.
- A follow-up log-only commit records publication. Main is unchanged; no merge, deployment or Windows checkout update occurred.

## Implementation record — N03 (2026-10-08)

- User said “go ahead” after the expired/consumed approval proposal, authorizing this specific NeuralOps fix. NeuralOps main source baseline: decd1cbd19caebfbaf4a645324ee496a0d27d1bc. No AGENTS.md was found in the current recursive repository tree.
- Independently traced gateStatus, isUsable, consumeApproval, perform, completed-task clearance and existing enforcement tests. Confirmed gateStatus accepted approved status without expiry/consumption checks and accepted old non-completion clearances as permission.
- Updated mini-services/neuralops-mcp/src/engines/authority.ts: shared usability rejects consumed permissions, exhausted/invalid counts and invalid/expired timestamps; uses actual instants, treats exact expiry as expired, and defaults omitted check time to now. Explicit replay timestamps remain supported.
- Updated src/engines/gate.ts: uses the shared predicate for non-completion approvals; historical non-completion clearances cannot bypass it. Completed-task clearance semantics, frozen workspace checks, task/action/scope matching and required verified evidence are preserved.
- Added tests/gate-approval.test.ts (12 regressions), scripts/test-gate-offline.cjs (Node 24 in-memory source loader), package script test:gate:offline and README guidance. The loader substitutes only bun:test with node:test; production store, authority, gate and error modules execute from source. No services or journal persistence listeners are initialized.
- Before fix: 4 passed, 8 failed, reproducing stale/expired/consumed approval, exact-expiry, malformed-count and clearance bypass behavior. After fix: 12 passed, 0 failed/skipped on Node 24.19.0. Source transformation/runtime parsing passed for loaded TypeScript modules; offline CJS runner syntax passed.
- Bun is unavailable. Full Bun suite, semantic TypeScript checking, actual processAct/journal replay, HTTP/CLI/hook flows and Windows execution remain unverified. No packages installed, paid calls, sockets, child workers, production state mutation, merge or deployment.
- Boundary: gateStatus remains read-only and does not reserve or consume permission. Check-only external actions can race or repeat before consumption; existing actor-bound perform consumes governed permissions. Mandatory external enforcement and artifact verification are separate proposed work.
- Publish target: a separate NeuralOps review branch/draft PR; Jarvis review source is unchanged by N03. Publication confirmation follows.

### N03 publication confirmation

- Implementation commit: e9398d62d07e78e97fd1b3bfd05d2bc5d75fc381 (seven changed/new files) on codex/strengthen-approval-usability. Branch update succeeded.
- NeuralOps draft review PR: https://github.com/z-sops/neuralops/pull/1. Main is unchanged; no merge/deployment performed.
- Follow-up log-only commits synchronize this record to the NeuralOps and Jarvis review branches. Windows installations remain unchanged.

## N04 investigation and concrete proposal — 2026-10-08

- Continued after the user's “go ahead”; no N04 implementation proposal had yet been presented, so inspected and prepared the next concrete change under the working agreement. No production source changed.
- Traced current replay.ts, store.ts, task-manager.ts, app.ts, agents.ts and admin.ts. State mutation and ledger notifications can precede persistence; processAct restores counters only on error. Registrations/admin changes also mutate before journaling. Simply removing the catch is insufficient.
- Real JournalFile and Store source executed in a Node VM with an in-memory filesystem; unused replay imports substituted. Injected ENOSPC into the first append, then allowed a second. First failed save returned normally; memory had two records, disk one line, head count two and one logged error. No sockets, live journal or production actions were involved.
- Concrete proposal: explicit persistence-failure state, clear failed/uncertain outcome instead of success, block further mutations and gate clearance after disk-write uncertainty, and defer successful observer notifications until persistence succeeds. Cover acts, registration, administration and genesis. Preserve the signed journal format.
- Distinguish pre-append failure from failure after bytes were written/head update failed. Do not blindly retry, silently reseed, promise disk rollback or report ambiguous work as safely unexecuted. Resume only through restart/recovery using a verified journal.
- Verification plan: in-memory append/head-write/rename failures; ensure no later writes or success notifications and test normal behavior. Power-loss fsync guarantees and automatic recovery are outside this proposed patch.
- Benefit: honest durable-success reporting, no further chain corruption after a failed append, and a clear disk-full/permission recovery boundary. Impact: persistence failure pauses governed work until recovery.
- Specific N04 source-implementation approval pending. No source fix, package installation, paid call, production state mutation, merge or deployment performed.
- Workspace execution transport disconnected during log-save attempts. Repository logs updated directly; local/saved standalone log synchronization remains pending.

## Implementation record — N04 (2026-10-08)

- User explicitly approved the concrete N04 proposal with “ok kardo”. Workspace access recovered; local project-update.md was synchronized with the repository investigation record before changes.
- Store adds synchronous whole-state transactions, buffered ledger/snapshot notifications, rollback of live memory/counters on thrown failure, and a process-local persistence-failure latch outside replayable data. Muted trusted replay remains supported.
- Acts, registration, all administration entry points and genesis use the boundary. Journal failures propagate as persistence_unavailable (HTTP status mapping 503); failed acts return an uncertain-disk-outcome message rather than durable success. Credentials are not returned from failed registration.
- Live JournalFile writes calculate candidate MAC/count without advancing live writer state until append/head succeed. Append/head/temp rename failures latch the fault. Rewrite and later backup/writes cannot bypass the latch. Signed format is unchanged.
- gateStatus denies clearance after persistence failure; performCheck raises the same clear error. Reset/import/replay/detach/load cannot clear the fault. Ledger/snapshot observers run after confirmed writes; observer errors are isolated from committed outcomes.
- Added scripts/test-persistence-offline.cjs and package test:persistence:offline. Existing gate offline runner now provides structuredClone for transactions. README documents recovery, overhead and verification limits.
- Verification: 13 persistence checks passed, 0 failures/skips. The actual Store, JournalFile, acts/admin/registration/genesis entry points and gates execute against an in-memory filesystem; Zod validation and unused demo seeding are explicitly substituted. Tests cover failure before/after append, head write/rename (including post-rename error), genesis write/rename, rollback/counters, missing success notifications, no later mutations/writes/clearance, latch preservation, successful signed journal loads and normal observer delivery. Existing 12 N03 approval tests also passed.
- Limits: whole-state cloning overhead is unbenchmarked; fsync/power-loss durability, multi-process transactions and automatic recovery are not added. Bytes may exist on disk after a failed operation; verify the recovered journal before retrying.
- Full Bun suite, Zod validation, semantic TypeScript checking, actual HTTP/MCP error transport and Windows/real-filesystem recovery remain unverified. No packages installed, paid calls, sockets, child workers, production data changes, merge or deployment.
- Publication will update the existing NeuralOps review branch/PR with N03 and N04 together; main and Windows installations remain unchanged.

- N04 syntax verification: seven changed TypeScript modules parsed/transformed successfully, and both offline CJS runners passed node --check. This is parsing, not a semantic typecheck.

### N04 publication confirmation

- Implementation commit: 4e1b0996f425d14ac13d095e9a72f5b44bb8b87d (12 changed/new files), published on codex/strengthen-approval-usability.
- NeuralOps draft PR https://github.com/z-sops/neuralops/pull/1 now covers N03 approval usability and N04 persistence failure handling.
- Follow-up log-only commits synchronize this record across NeuralOps and Jarvis review branches. Main and Windows installations remain unchanged; no merge/deployment.
- Local standalone log synchronization resumed after workspace access recovered.

## N02 scope investigation — 2026-10-09 (Asia/Karachi)

- User approved inspection/proposal preparation with “ok” after the next-step explanation. This authorizes analysis and log maintenance, not yet the new enforcement implementation. No production source changes or behavior tests were performed in this step.
- Inspected current Jarvis review-branch main.js, lib/gateway.js, lib/workers.js, lib/home.js, lib/tools.js, lib/browser-mcp.js, lib/browser-tools.js, lib/hermes.js, lib/sandbox.js, lib/opencode.js and lib/fsmcp.js; inspected NeuralOps review-branch task-manager.ts, protocol/payloads.ts and mcp/tools.ts. A guessed mcp/registry.ts path returned 404; repository tree discovery identified mcp/tools.ts, which was then read.

### Actual execution boundaries

| Path | Source evidence | Current guidance gap |
| --- | --- | --- |
| External connectors and native Files/Library/Leads | Gateway.call -> Hub.authorize -> upstream/provider.callTool | Orbit permission/allowlists exist; no mandatory NeuralOps guard before invocation. |
| Gateway native search/screen tools | Gateway.callNative -> Hub.authorize -> native function | Separate dispatch branch also needs the shared guard. |
| Browser MCP actions | browser-mcp tools/call -> BrowserTools.execute, without Gateway.call for browser tool names | A gateway-only patch would miss browser actions. Browser's existing permission handling must remain. |
| Laila and built-in workers | tools.exec -> local decide/ask -> IMPL; workers' Gemini loop calls tools.exec directly | Separate built-in path; runtime context must be trusted and captured before any approval wait. |
| Hermes direct shell/file execution | Hermes profile configuration; optional Docker terminal backend | Direct engine tools do not automatically cross Orbit's MCP boundary. Sandbox is optional and not a NeuralOps gate. |
| OpenCode direct execution | writeProjectConfig grants bash '*' allow; opencode run launches independently | No inspected NeuralOps/MCP authorization hook in this path. Do not claim full coverage from gateway integration. |

### Weak transitions confirmed in source

- Home.createJob persists only job ID, agent, task text, queued status and creation time. It has no automatic NeuralOps task binding. Workers.run/dispatch maintain active jobs in memory; they do not automatically create/claim a NeuralOps task.
- Workers.run marks a job done once the engine returns final text (after cancellation check); it does not require NeuralOps completion/verified artifact acceptance. N05 artifact verification remains separate.
- NeuralOps perform handles direct authority/policy/consumable approval and records authorization, but the inspected handler does not require task ownership/in_progress or matching gate requireVerified evidence. It permits ungoverned actions. perform_check is read-only; gate_status does not consume approval. Calling either alone is insufficient for strict managed execution.
- Existing approval matching is requester + action + scope + task. target/detail are displayed data, not a machine-enforced argument binding. Approval for one concrete call must not silently authorize changed arguments.
- Current gateway tokens bind worker identity, not a job execution generation. A strict job integration needs job-bound credentials/context, including rejection of stale calls and rechecking after user approval waits. Binding an arbitrary caller-supplied taskId is insufficient.

### Concrete staged proposal — N02-A

1. Add explicitly configured managed-job execution. Persist a unique Orbit job -> NeuralOps task binding; create/claim before starting governed work. Missing mapping, unavailable service or unclaimable task blocks that managed job. Use execution-generation-bound worker access so stale requests cannot inherit a later job's permission. Keep configuration migrations explicit and preserve existing architecture.
2. Centralize the guard across Orbit-mediated connectors/providers, native gateway tools, built-in tools and browser agent calls. Preserve Orbit's user dialogs/allowlists; a dialog acceptance is not fabricated as a NeuralOps human authorization. Exempt only narrowly enumerated coordination/read/control operations needed to request approval, inspect state or stop work; unknown actions have no implicit write clearance. Actual user-operated controls remain distinct from agent calls.
3. Use trusted tool/action/scope configuration and canonical call identity rather than model-supplied metadata or description heuristics. Bind approval to the intended operation/arguments, enforce task owner/runnable state and required evidence together with permission consumption in the NeuralOps server authorization step. Never allow ungoverned fallback in strict managed mode.
4. Revalidate job generation, cancellation, connector identity/access and normalized arguments immediately before the governed invocation, after any await/user dialog. A pending/denied/expired approval, frozen workspace, persistence fault, missing evidence or unreachable service blocks execution. Do not automatically retry a non-idempotent action with uncertain outcome. An approval consumed before an external failure is not silently restored.
5. Treat engine-returned text as a report pending acceptance, not a verified completion. Link the managed task lifecycle and display blocked/pending/final states honestly. A successful authorization record is not proof that the external action completed; retain a separate outcome/evidence record. Full artifact checking remains N05.
6. Strict coverage cannot be claimed for Hermes/OpenCode direct code tools without separate engine hooks. In managed mode, reject/disable uncovered capabilities (with a clear reason) until those hooks are added; do not silently let shell/file tools bypass the guard. Preserve ordinary ungoverned jobs explicitly as unmanaged rather than claiming system-wide protection.

- Benefit: approvals and task state become enforced at Orbit-mediated execution boundaries, with task ownership and call identity preserved instead of relying on the model to remember to check.
- Impact: managed jobs pause/block when guidance is unavailable or approval/evidence is missing; unrestricted external engine code capabilities need dedicated hooks before use in strict managed mode. This is a coordinated Orbit + NeuralOps change, not a one-file gateway patch.
- Next-stage N02-B: actual Hermes/OpenCode enforcement hooks, verified engine-tool coverage, and stronger end-to-end lifecycle/artifact checks. Do not label either gateway guard or optional Docker sandbox as universal enforcement.
- Planned offline verification: denied/unavailable guard never calls the downstream tool; task/actor mismatch and stale generation rejection; changed arguments/permissions after an approval wait; separate browser/built-in/native/provider paths; coordination bootstrap without recursive authorization; existing dialogs retained; single-use concurrency/consumption and persistence faults; explicit rejection of uncovered engine capabilities. Live engine/Windows/SDK verification would remain separately pending under existing restrictions.
- N02-A source implementation requires specific approval after this concrete scope is presented. No dependency installs, paid calls, worker/service execution, database mutation, merge or deployment in this investigation.

## ZCode read-only reference review — 2026-10-09 (Asia/Karachi)

- User paused implementation to show other folders, then explicitly requested a read-only check of https://github.com/z-sops/zcode using the GitHub plugin. Paused Orbit/NeuralOps implementation remains paused. No repository writes/publishing authorized or performed for this review.
- Reviewed pinned ZCode main commit fd313ae3d32db243e61af26fc0be4501584d4690, version 0.31.1. Recursive repository tree returned 3,428 entries without truncation. Read AGENTS.md, package metadata and focused source sections; this is a reference review, not a complete security/runtime audit.
- Stack: Tauri/Rust, Next.js/React, SeaORM/SQLite, ACP agents and zcode-mcp companion. This differs from Orbit's Electron/Node stack; implementation patterns need adaptation rather than wholesale source transplantation. README claims were not treated as runtime verification.

| Mechanism evidenced in source | Evidence files | Relevance to Orbit strengthening | Verification status |
| --- | --- | --- | --- |
| Task-bound execution generation and conditional database transitions | src-tauri/src/db/entities/work_task.rs; db/service/work_task_service.rs settle_review; work_task/engine.rs record_complete | Persist job/task/run binding and refuse stale completions after cancel/retry. | Implemented in inspected source; not runtime verified here. |
| Per-launch companion token -> parent connection mapping and revocation | acp/delegation/listener.rs TokenRegistry and process_status | Useful reference for N02 job-generation credentials; caller-supplied task/actor should not determine ownership. | Implemented in inspected source; no token/service test run. |
| Asynchronous delegation with typed requests/results, depth limits, status/cancel/resume | acp/delegation/types.rs, broker.rs, service.rs | Reference for Laila/worker structured lifecycle instead of final-text-only completion. | Implemented in inspected sections; end-to-end behavior unverified. |
| Per-task worktree setup/recovery and review/merge lifecycle | work_task/engine.rs; db/entities/work_task.rs | Reduce shared checkout conflicts and separate report/review/acceptance. | Source evidence; no git operations executed. |
| Central expert/custom skills store and per-agent linking | commands/experts.rs, commands/custom_skills.rs | Useful reference for shared skill catalog + worker enablement. Link/install machinery does not prove dynamic task-skill selection. | Source evidence; no installation/links changed. |
| Live-agent command-aware context compaction | work_task/compact.rs; engine.rs compact_before_prompt/await_compaction_turn | Choose supported compact commands, use actual occupancy, guard session identity and avoid compaction completion settling the real task. | Source implementation and test source exist; tests not run. |
| User plan approval state and teardown handling | acp/plan_approval.rs | Approval cards survive snapshot/reconnect; disconnect drops pending decisions. The inspected adapter targets Grok plan-exit requests, not universal NeuralOps action authorization. | Source evidence; UI/transport unverified. |
| Host filesystem/terminal ownership policy | acp/host_tools_policy.rs, file_system_runtime.rs | Important warning: host-executed tools can bypass an agent's own OS sandbox. Guard every execution channel and delegation escape path. | Source evidence; no OS sandbox test run. |

### Important limits for reuse

- host_tools_policy defaults to hosting fs/terminal; invalid settings fall back to default. Agent-hosted mode is opt-in and withholds both channels plus delegation to avoid a sibling bypass. Default filesystem reads are unrestricted; an fs path gate alone does not contain a host shell. Do not copy these defaults into strict managed enforcement without explicit policy decisions.
- Work task verdict is documented as an agent self-report; review/preflight is separate. Source also contains an auto-merge sweep with eligibility checks, so human approval on every final merge must not be assumed from a review state alone. Automatic artifact correctness is not established.
- Compaction sends a supported compact command and waits for the resulting turn. It does not by itself prove exact preservation of all permissions, state or context across different providers. Occupancy without real size/usage is treated as unknown.
- No dedicated NeuralOps/Guardian/Context-Gate/cross-tag/continuity filenames were found in the tree-name search. This is limited negative evidence, not a proof that related functionality is absent from every source path. Previously requested nine layers are not classified as fully implemented/verified from this review.
- No dependency installs, test/build executions, paid/model calls, worker/service launch, production state changes, source edits, commits, pushes, merges or deployments. All features above remain implemented-but-unverified in this session.
- Recommendation: revise N02 around existing ZCode references for per-launch ownership, run-generation checks and review lifecycle, while keeping Orbit's product and NeuralOps' typed guidance architecture. Do not resume implementation or migrate/merge systems without the user's instruction.
- Log is saved locally/with the standalone record only. Repository log synchronization remains paused at the user's request; the prior automatic rejection of a NeuralOps log commit is not bypassed.

## ZCode patterns adapted to Orbit — run-lifetime foundation (2026-10-08 UTC)

- Authorization: user resumed the pause with “toh le lo jo acha hai apna code karlo”. Adapt useful mechanisms into existing Orbit code, preserve architecture, and record work here. The earlier pause/rejection remains historical; this is new explicit authorization. No stack migration or ZCode source transplant.
- Scope: first adapted pattern is execution-generation ownership and per-run gateway credentials. Full N02 managed NeuralOps authorization is still incomplete; this foundation alone does not authorize task actions or verify artifacts.
- Before: gateway HMAC was stable per worker ID, so the same worker could retain access between jobs; engine callbacks captured actor/job but could still update trail/state after settlement. Hermes cancellation during server preparation could miss its newly registered request abort listener.
- Change: new `lib/job-runs.js` uses main-process AsyncLocalStorage, immutable run contexts and random UUID generations. Workers stamp each started job with runId, reject overlapping direct runs, guard progress/text/usage/checkpoint/tool callbacks, and revoke credentials on abort, normal settlement or setup failure. Old cleanup cannot release a replacement generation.
- Change: worker profile credentials bind actor plus live run generation. Idle/finished/cancelled workers have no valid token; the next job gets a different token even if the worker or job ID is reused. Diagnostic bridge-check has a process-local discovery-only credential.
- Change: MCP captures the authenticated run before waiting for the request body, then rejects expired requests. Gateway connectors/native providers and built-in tools recheck after authorization waits. Main-process permission answers revalidate the captured run; browser DOM/input/navigation/tab dispatch checks the same context after awaited work. Internal Laila and user UI paths retain their existing permission rules.
- Change: Hermes checks cancellation before/after server preparation and before posting; abort listeners are removed on request completion. OpenCode preflight return is rechecked before worker task dispatch. Existing profile signatures refresh credentials between jobs, potentially restarting the Hermes worker server; this cost was not benchmarked.
- Verification: `node --test jarvis-work/test/job-runs.test.js jarvis-work/test/gateway-auth.test.js jarvis-work/test/neuralops-identity.test.js`: 29 tests, 29 pass, zero failures/skips. Ten new tests exercise run/token revocation/reuse, concurrent async contexts, delayed HTTP body, late connector/native/shell approval, real worker lifecycle with engine doubles, stale callbacks/tool closures, setup failure/overlap, browser dispatch/constructor and Hermes preparation cancellation.
- Verification: 13 touched/new JavaScript syntax checks and package.json parsing passed. Existing real HTTP fixture updated for explicit generations but was not executed. Tests use memory transports/filesystems and mocked engines; no sockets, dependency installs, paid/model calls or worker subprocesses.
- Review caught and corrected a constructor initialization ordering error before publication; the regression now instantiates the real BrowserManager with a fake IPC interface, in addition to checking its dispatch methods.
- Status: implemented and verified for these focused in-memory paths. Full npm suite, actual Electron startup/UI, Windows, real Hermes/OpenCode/profile reload, external SDK transport and NeuralOps integration remain unverified. This environment has scoped source snapshots rather than Zee's Windows checkout.
- Limits: revocation cannot undo already dispatched actions or cancel external engines' direct shell/file capabilities. Pending permission cards keep their existing timeout, but a late answer cannot run the stopped job. Shared browser sessions, durable queue/restart reconciliation, artifact acceptance, mandatory NeuralOps task-owner/evidence/argument-bound authorization, worktree isolation, structured delegation, skills selection and provider-aware compaction remain separate work. No claim of complete N02 or universal sandboxing.
- Documentation: README.md, AGENTS.md and this record updated; new regression added to package test script. Publication target is the existing draft Jarvis PR #1; no main merge, deployment or Windows update.
- Publication confirmed: run-lifetime implementation committed as a2776dd0a3896abf03ce28d26188d1ba57a88498 on codex/strengthen-neuralops-identities, and existing draft https://github.com/z-sops/jarvis/pull/1 updated to describe final scope. Source/tests/docs are reviewable there; main remains unmerged and the Windows checkout is untouched. A compatibility refinement allows unscoped legacy tool fixtures without a runtime registry; the 10 run-lifetime cases and tools syntax were rerun and passed afterwards.

## Autonomous strengthening and automated UI verification — 2026-10-08 UTC

### Authorization, source integrity and reference coverage

- User authorized autonomous changes and requested Playwright automated testing. Existing Electron/Node/CommonJS product architecture preserved. No ZCode source files transplanted into Jarvis, no NeuralOps source changes this turn, no main merge/deployment or Windows checkout modification.
- Jarvis source restored from existing draft branch head a7489242bd8c16a84d1b44d36182075574604240: 193 selected text files, five PDF test fixtures, five font files and .gitignore. Every restored file's Git blob hash was checked against the pinned tree before editing. Existing branch identity/generation protections were retained.
- ZCode complete tree inventory: pinned fd313ae3d32db243e61af26fc0be4501584d4690, 3,428 entries and 299 directories, not truncated. Separate reference snapshot has 1,950 selected text files, 38,974,406 bytes and 935,545 lines, all blob-hash verified with zero missing/mismatched selected files. Folder/source/import indexes cover the selected files. 492 frontend test files, 17 Rust integration files and 241 Rust files with inline test annotations are file counts, not executed test-case counts.
- Deep source tracing focused on ACP delegation/tool ownership, task state/worktree/review/preflight, compaction, browser origins/consent, token/CORS and keyring paths. All folders were inventoried; every source line was not semantically reviewed. ZCode tests were not executed and its code was not modified.
- Adapted mechanisms in original Jarvis JavaScript: atomic state/history snapshots, generation-aware state updates, replay-safe recovery and separate report/review/acceptance. Per-task worktrees, strict task-scoped NeuralOps gates and provider continuity remain future work.

### Changes and their benefit

| Gap | Implemented adjustment | Benefit and limit |
| --- | --- | --- |
| Job JSON overwrite could leave partial records; IDs could collide; older jobs were omitted by lookup limits | New lib/job-storage.js: UUID job IDs, validated record identity/path, same-directory private temporary write, file fsync and atomic rename; state plus bounded 100-event history saved together; run/status comparison guards; direct ID lookup | Durable single-main-process job records and traceable transitions. Not a multi-process database or tamperproof ledger; directory fsync is best-effort on Windows. |
| Restart left running/queued jobs ambiguous; automatic replay could repeat side effects | Home.recoverJobs marks running jobs interrupted and queued jobs as requiring explicit retry; retry intent/link recovery; malformed/unreadable/unwritable storage blocks affected worker without crashing startup | Restart does not silently rerun a model or external action. Explicit retry still requires inspecting outputs because remote outcomes may be unknown. |
| A worker's final text was treated as completed work | Nonempty reports now settle at review; empty reports fail. UI-only trusted-main-frame accept/reject controls; acceptance metadata persisted. Laila/worker tools cannot accept a job | Human report review is distinct from machine verification. Direct host tools still have same-user filesystem access, so stored acceptance is not tamperproof against such tools. |
| Claimed output files were not checked | Optional expected workspace-relative output files, at most 20; reject traversal/absolute paths; bounded regular nonempty file checks with symlink rejection, 8 MB limit and SHA-256 evidence; recheck at acceptance and flag changed fingerprints | Missing/empty/changed outputs block acceptance. File existence/hash does not prove quality, tests, provenance or that a pre-existing file was created by this job; no OS isolation guarantee. |
| Failed jobs lacked durable retry lineage and could double-dispatch on retry clicks | Persist retrying intent before child creation, retryOf/retryJobId linkage, expected-output preservation, inspect-before-repeat recovery prompt and interrupted retry reconciliation | Distinct, auditable retry jobs; no duplicate from repeated UI retry. Cancellation remains engine-dependent for an already dispatched action. |
| Storage/listener failures could imply a false successful outcome | Block further worker dispatch on unsaved outcomes, emit job:storage-error; secondary memory/event-listener errors cannot replace a durably saved review result; free run ownership on settlement/setup failure | Clear unknown-outcome handling and fewer false completion reports. Repair/restart is required for unhealthy storage. |
| Quota or lost remote response could replay a whole action | Hermes per-minute quota no longer auto-reposts the entire goal; connector callTool no longer auto-retries after invocation; recheck cancellation/run ownership after connection waits | Avoids automatic duplicate side effects. Failures may still have happened after remote actions; service/output inspection is required before retry. |
| Office could erase a typed job during background refresh | Latest-render guard and per-worker form drafts; Give a job form, output expectations, accept/reject/retry controls, legacy unverified labels, recovery state and inline blocked-acceptance errors | User can submit/review work explicitly and keeps their draft across asynchronous refresh. Drafts are renderer-local rather than durable across app restart. |
| PDF tests used a require-resolved package path but ESM import could not resolve that same package | Import the resolved PDFJS legacy module through a file URL; restore exact existing PDF fixtures; update stale tool/completion test expectations | Actual PDF text/Library fixture tests execute under the available runtime. Locked PDFJS version was not installed/tested. |

- Required output paths are included in built-in, Hermes and OpenCode task prompts and built-in checkpoint goals; report/continue keeps them in resume notes.
- Startup performs reconciliation without replay. Changing home folder or commissioning while jobs are pending is blocked. Quit requests worker cancellation; no guarantee that a non-cooperative external engine stops immediately.
- Windows drive and UNC component parsing has a pure win32 regression, but actual Windows file/rename behavior has not been exercised.
- README.md, AGENTS.md, package test commands and ignored UI-result directory updated. New scripts/playwright-smoke.js provides reproducible renderer/backend smoke checks using already available Playwright/Chromium, not a new package dependency.
- Playwright found a real Office repaint/form-state failure during the first run. The refresh/draft implementation was fixed and an explicit regression was added before the final passing run.
- Prior section describing automatic Hermes quota whole-goal retry is superseded by this safer explicit-retry behavior.

### Verification evidence and exact scope

- Initial local baseline: 307 tests, 289 pass, 11 fail, seven skip. Failures were two stale Laila tool expectations and nine missing-fixture/module-resolution PDF failures. Existing fixtures were restored with exact hashes and the PDF import issue was fixed; failures were not hidden by skipping those tests.
- Final npm test: **329 tests, 322 pass, zero fail, seven skip**, 26.802 seconds. Includes **22 new job recovery/review/storage/output/control regressions**, plus existing routing, identity, run-lifetime, crew, permissions, Library/PDF and other offline coverage.
- Seven skips: three real Hermes integration checks and four official MCP SDK transport integration checks. They did not pass and remain unverified. PDF/Library fixture coverage used preinstalled pdfjs-dist 5.6.205; the project's locked 6.3.289 version remains unverified.
- **22 touched/new JavaScript syntax checks and package.json parsing passed.**
- Final Playwright: **15 checks passed**, four fixture engine calls, zero renderer exceptions/console errors. Tested actual renderer HTML/JS/CSS/fonts and actual preload API against real Home, Workers, job controls and panel/backend modules in an isolated temporary home. Electron window/IPC transport and provider engines were fixtures; external network was blocked.
- Playwright coverage: returning-user boot; all seven screens; recovered jobs without replay; legacy unverified labels; missing-output acceptance blocking; report-only human acceptance remains unverified; rejection persistence; retry linkage and duplicate prevention; form dispatch/output check/acceptance; unsafe output rejection before job creation; draft preservation during refresh; report markup rendered as text; Stop cancellation; accepted state after reload; no renderer exceptions or console errors.
- Existing Chromium 153.0.8010.0 and Playwright/runtime modules were reused. No dependency download/install, live model/provider calls or production database writes were used for successful verification.
- Local evidence: verified-tests.log, verified-playwright.log and playwright-results/results.json; browser trace and screenshot are temporary test artifacts, not committed source. New smoke runner is committed so checks can be repeated.
- Dependency attempt: automatic approval review rejected npm ci because it would install/download dependencies and replace the local dependency tree without explicit installation authorization under the audit restriction. The rejection was not bypassed or retried through another installation route. Exact locked dependencies, actual Electron startup and official SDK integration are blocked until installation is explicitly authorized.

### Remaining gaps — do not classify these as fixed

- Mandatory NeuralOps task-owner/action/evidence/argument-bound authorization across every execution channel is incomplete. Existing identity and run-lifetime controls are a foundation, not complete managed guidance.
- Per-task Git worktrees/file ownership conflict prevention is not implemented; workers can still target shared external paths. Workspace evidence checks are not shell containment or an OS sandbox.
- Dynamic skills selection, structured worker handoffs/dependencies, independent contradictory-result/semantic artifact checking, provider-switch continuity/compaction and full routing health/observatory requirements need further traced implementation and verification.
- Actual Electron/Windows execution, live Hermes/OpenCode/provider/model switching, live NeuralOps and real MCP SDK transports remain unverified. No claim that the entire audit or product is fully fixed.
- Publication target: existing draft https://github.com/z-sops/jarvis/pull/1 and codex/strengthen-neuralops-identities. No merge or deployment. Review branch source/tests/docs include this log; changes take effect only after the correct checkout is updated and Orbit restarts.

- Publication verified: implementation, regression tests, Playwright runner and this record committed as c032341c8be686468a5e07fc1fab2d356eb40296 on the existing draft Jarvis branch; all 27 published file blob hashes match the reviewed local files. PR #1 title/body updated with final scope and test limitations. Main was not merged; Windows checkout remains untouched. This confirmation is recorded in a follow-up documentation-only commit.

## Continued gap work — 2026-10-09 (Asia/Karachi), implementation in progress

- User explicitly approved dependency installation with “haan toh karo” and expanded the objective to “complete all the gaps please”. Per-change permission is not required within existing scope. Prior install rejection is historical, not bypassed; new explicit authorization allowed installation.
- Found a reproducible package-lock/package.json mismatch: npm ci refused because optional Electron packaging dependencies were absent from the lock. Repaired the lock using package-lock-only (without lifecycle scripts), then npm ci --ignore-scripts succeeded with 362 packages. Electron's own binary installer ran separately; Electron 44.4.3 launched successfully. No provider calls/production data writes.
- Exact installed SDK/PDF/Electron versions match lock entries: MCP SDK 1.30.0, pdfjs-dist 6.3.289 and Electron 44.4.3. Full suite after installation: 329 total, 326 pass, zero fail, three real Hermes skips. Four SDK integration tests that previously skipped now actually pass against local real HTTP MCP fixture services.
- New original Jarvis code (no ZCode source copies): lib/job-contract.js validates existing dependencies and bounded skill selection; automatic keyword selection and explicit library skills stored with SHA-256 and selected instructions. Dependency jobs require human-accepted prerequisites, fail if prerequisites stop/reject, and support Stop while waiting. Fresh Git project jobs use detached per-job worktrees from committed HEAD; dirty source checkouts are preserved/refused; no automatic merge/removal.
- Structured handoffs copy only accepted evidence artifacts into job-specific folders and recheck fingerprints, reject secret files and symbolic-link destination components. Parent reports are tagged as untrusted data, not approvals. Coding job prompts, built-in file base paths, OpenCode cwd and Hermes profile cwd/sandbox output mount now use the isolated worktree. UI and assign_task expose project/dependency/skill options.
- Seven new contract tests pass, including real Git parallel worktree isolation, dirty checkout preservation, skill selection and dependency acceptance/rejection/cancellation. With the initial contracts included: 336 tests, 333 pass, zero fail, three skips. A synchronous callback regression introduced by an unconditional await was caught and fixed; all 17 focused run-lifetime/contract tests passed afterward.
- Checkpoint strengthening: atomic writes, full goal preservation instead of truncating at 1,500 characters, responses matched to tool names, explicit error/exit-code failures, and unknown action/approval cautions in continuation text. Pause/continue retains expected outputs, dependencies, skill names and previous worktree reference. This is not yet complete state-preserving cross-engine continuation or automatic transplantation of uncommitted worktree edits.
- Playwright renderer/backend smoke remains 15/15 passing after UI contract changes. Actual Linux Electron smoke runner scripts/electron-smoke.js now passes seven checks: real boot/preload isolation, all screens, startup recovery, missing-artifact rejection, acceptance distinctions, real rejection/unsafe dispatch IPC and reload persistence. A proposed second-window inspector-driven check closed the headless target; it was removed from this runner and remains unverified in actual Electron (foreign caller rejection is still tested at the job-control unit boundary). No claim that it passed.
- These changes were subsequently verified and published to the existing draft branch (confirmation below). Mandatory NeuralOps task/action/evidence/argument-bound enforcement, independent semantic verification, full observatory/router behavior, complete provider continuity and actual Windows/live engines remain pending. The user asked for all gaps; do not claim completion based on this slice.

- Final slice validation: **341 total tests, 338 pass, zero fail, three real Hermes skips** (38.084 seconds); **15 Chromium fixture UI checks** and **seven actual Linux Electron UI/IPC checks** pass. **17 JavaScript syntax checks** pass. After the final worktree-only undo snapshot adjustment, **16 contract/continuity/directory-undo tests** pass. Dependency-lock comparison confirms **13 added package entries and no changed existing locked package versions**. Total new regressions in this slice: nine contracts/handoffs plus three continuity checks. Final documentation and publication are underway; remaining guidance/observatory/semantic/provider-continuity layers stay open.

- Publication confirmed: task-contract/worktree/handoff/continuity implementation and actual Electron runner committed as c02d16a1265e2d054735daac416b953fcfd92fed on the existing draft Jarvis branch. All 22 published file blob hashes match reviewed local files. PR #1 title/body updated with final scope, exact dependency versions, 338 passing tests, 15 Chromium checks, seven Electron checks and remaining gaps. No main merge/deployment or Windows checkout update.
