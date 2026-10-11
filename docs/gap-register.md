# Orbit gap register — 2026-10-10

This register describes verified boundaries, not overall production readiness. Existing architecture stays in place. Reference products are discussion inputs, not integration decisions. Before introducing another framework, document existing behavior, end-to-end evidence, the actual gap, whether an extension suffices, and dependency/integration risk.

## Strengthened in this slice

| Capability | Status | Evidence and boundary |
| --- | --- | --- |
| Settings, connector tokens and worker override keys at rest | Implemented and verified with a synthetic encryption provider | Electron safeStorage injected by main; startup migration; unavailable/insecure Linux key stores refuse secret writes; corrupt/locked files preserved. Real Windows DPAPI/key-store migration still unverified. |
| IPC invoke origin | Implemented and verified | Shared guard requires the current main window and main frame before handlers run. Synthetic foreign/subframe tests and actual Electron main-frame smoke. Does not authenticate human intent in a compromised trusted renderer or cover ipcMain.on listeners. |
| Built-in per-job model request cap | Implemented and verified | Every model POST reservation, retry/fallback and nested Gemini generation shares a limit, including the permitted recovery continuation. Persistence failure prevents submission. Default 40, configurable 1–500. Not a token/money cap, and not a native-engine/commander/voice cap. |
| Bounded text reading | Implemented and verified | Existing read_file and Files read_text_file accept UTF-8 byte windows, with bounded descriptor reads, validated offset/limit and binary/malformed-text refusal. Existing permissions remain. Large-file tail now reads the actual end. |
| Read-history compaction | Partially implemented; bounded path verified | Built-in requests may omit older read_file data in a copy of the outgoing body, keeping the latest two reads and preserving original conversation, calls, model text, signatures and effect results. Hashes are references, not approvals or durable snapshots. Protected context that still exceeds 128 KiB fails. |
| Fifty-worker queue stress | Implemented and verified offline | 50 configured workers, 100 jobs, concurrent workers, serial jobs per worker, distinct models/workspaces and artifact evidence. Synthetic Hermes engine: no live capacity, resource-load or OS security claim. |

## Additional strengthened paths

| Capability | Status | Evidence and boundary |
| --- | --- | --- |
| Project content binding at acceptance | Implemented and verified offline | Existing review hashes HEAD plus every tracked and nonignored untracked file (including deleted/empty files), bounded to2000 files/64MiB total/8MiB per file. Changed fingerprint blocks acceptance and records fresh evidence for explicit human re-review. Ignores Git metadata and ignored files. Not an atomic OS snapshot or independent review/test proof. |
| Worker execution deadline and unresponsive cancellation | Implemented and verified offline | Default1800 seconds/configurable1–86400. Signal-ignoring engine waits settle, queue releases, timeout is failed rather than user-cancelled, late callbacks remain fenced. Timer does not keep a quitting process alive. Native process/tool effects may continue if its engine does not honor cancellation; OS containment is still open. Dependency waiting has its own30-minute limit; synchronous setup may delay timer delivery. |
| Typed lifecycle checkpoint | Partially implemented; runtime path verified | Full goal, lifecycle plan/current stage, preserved decision records, actor/job/run/revision, files and reported-complete/failed/unknown tool outcomes survive checkpoint projection. Empty approvalRefs prevents inherited grants. This is not generated project planning, complete typed approval provenance, temporal truth or native internal history restoration. |
| Built-in worker model/key overrides | Implemented and verified offline | Explicit built-in workers use their selected Gemini model/key without changing commander defaults. Async scope preserves those fields in nested Gemini generation during that loop; parallel scopes tested. Unsupported built-in provider fails before engine execution. This does not complete capability/cost routing or live model discovery. |

## Independent QA slice

| Capability | Status | Evidence and boundary |
| --- | --- | --- |
| Revision-bound independent review and Node host tests | Implemented and verified offline within Node scope | Different reviewer worker, source snapshot, human-accepted structured verdict, unchanged artifact/source, current candidate fingerprint, actual host Node declared-test result, and separate final human acceptance. Existing job store/queue/permission flow reused. Storage-fault linkage, denial/Stop/deadline/restart, stale code, empty/skipped/forged/excessive output tested. Actual Electron approval/busy/test/acceptance block verified. Reviewer model quality, meaningful test coverage, native containment, other languages and Windows execution remain unverified/incomplete. |

## Remaining engineering work

These items need further implementation or a separate end-to-end proof; they must not be relabelled as merely waiting for user credentials.

| Priority | Gap | Required completion evidence |
| --- | --- | --- |
| P0 | Complete typed continuation state | Persist and restore goal, plan, current step, decisions, outcomes and approval provenance; ambiguous effects must not replay. Existing checkpoint manifests are a foundation. |
| P0 | Broader independent QA coverage and containment | Node host-test gate and separate reviewer identity/snapshot are implemented and verified offline. Still prove real reviewer quality, useful test coverage, supported non-Node commands/languages, Windows termination and native containment. Fingerprints exclude ignored files/Git metadata and are not atomic OS snapshots. |
| P0 | Cross-engine enforcement | Prove every relevant native action reaches the intended permission/run/managed gate; contain bypass paths. Git worktrees/profile folders are not OS sandboxes. |
| P1 | Complete Laila orchestration | Structured feasibility/team sizing, dependencies, contradiction handling, artifact-aware progress and robust stuck-worker handling. Do not infer these from prompts alone. |
| P1 | Reliable capability/cost router | Verified availability/authentication, capability matching, bounded fallback and safe continuity across providers. Existing routing and health adapters are partial foundations. |
| P1 | Token/financial budgets | Measured usage, reservation/reconciliation and appropriate caps across supported engines; request counts and UTF-8 bytes are separate units. |
| P1 | Full project/task context access and temporal knowledge | Explicit scope, provenance, expiry and verified learning; assigned skills and memory origins cover only part of this requirement. |
| P1 | Product onboarding and observability | Real goal-to-team workflow, clear blocked states, dependencies and evidence/cost presentation; user testing instead of screenshot claims. |
| P1 | Complete managed multi-engine integration proof | Live NeuralOps identity, permission decisions, handoffs, receipt reconciliation and cancellation across real engines. Offline fixtures cover contracts, not deployment behavior. |

## Environment/user-dependent verification

- Windows installer, tray/autostart, process quoting/cancellation, restart recovery and OS credential encryption on the user's actual machine.
- Real Hermes/OpenCode discovery, model switches and tool routing using an explicitly selected low-cost task; no paid call is authorized by this document.
- Real NeuralOps service and accounts for the live integration benchmark.
- Actual microphone, voice and comms integrations; outbound messages require explicit authorization.
- Standalone Playwright browser suite: current saved Chromium is truncated and crashes before checks; no installed default browser is available. Restore a complete supported browser before counting a rerun. The separate actual Electron smoke does not replace that suite.

External Hermes profiles/.env files, native engine credential stores, process environments and in-memory credentials remain separate exposure boundaries. safeStorage is OS-user protection, not protection from all processes running as the same user. Legacy plaintext is preserved if migration cannot safely encrypt it; never claim that every old file is encrypted in that state.


## Five requested gaps — current slice

| Gap | Implemented path | Remaining boundary |
| --- | --- | --- |
| Laila planning | Durable DAG, bounded assumptions/risks, role/assigned-skill availability, existing job dispatch, fresh human-accepted dependency evidence, exact contradictory claims and human resolution | Business feasibility, optimal staffing, automatic team creation, free-form/native semantic contradiction analysis, dedicated planning UI |
| Model router | Gemini worker allowlist, credential/policy scoped discovery, configured token-price preference and context-preserving fallback | Other-provider automatic routing/auth health, capability scoring and live model availability |
| Token/cost budgets | Full-request count, persisted reservations, actual usage settlement, shared nested/retry/continuation ledger; settings UI | Token prices entered explicitly; non-token fees/overbilling outside claim; native jobs fail closed when capped |
| Continuity | Original worktree owner survives repeat retries; host decisions/budget persist; fresh run with no inherited grants | Native transcript restoration, complete typed approvals, OS-atomic snapshots and multi-file crash transactions |
| Native security | OpenCode 1.x isolated config/env and shell/outside denial; Hermes manual-approval profile/cwd/cancellation fixes; passive unknown-state telemetry | Real CLI enforcement, Windows process-tree behavior and OS sandbox escape resistance; worktrees are not sandboxes |

The five broad requirements remain partially implemented. Offline fixtures establish the listed execution paths, not live engine behavior or full product completion.


## Native budgets and continuity slice

| Capability | Status | Evidence and boundary |
| --- | --- | --- |
| Native pre-generation token/cost/request limits | Implemented and verified offline for supported broker traffic | Real loopback HTTP + Gemini/OpenAI/Anthropic fixture endpoints; full converted input count, persisted maximum-output reservation, actual usage reconciliation, immutable continuation policy, missing usage/storage/cancel/concurrency refusal. Actual OpenCode adapter spawns fixture CLI; actual Hermes request/SSE transport calls fixture local API. Live engine compatibility remains unverified. Unsupported providers/features still refuse. Provider count is not exact billing assurance; OS-level bypass is outside scope. |
| Native host model conversation restore | Implemented and verified offline | Encrypted messages, system changes, tool IDs/results and opaque reasoning/signatures restored through existing jobs; trimming/switches/ambiguous tools block. Native private session databases, plugin/TODO/UI state, cross-provider conversion and automatic pause/resume remain incomplete. |
| Human approval provenance | Implemented and verified offline within host job prompts and broker tool gates | Origin/receipt ID/job/run/prompt hash before permission returns; exact native tool argument hashes before delivery; cancellation/storage failure refuse. Receipts survive retry as history, never grants. A compromised trusted renderer, engine-internal/unmediated approval and OS-user tampering are outside this proof. |
| Crash-consistent linked retry records | Implemented and verified offline with recoverable intents | Source intent, child history/budget/receipts and plan ownership repair; injected crash after child creation, idempotent second startup, no automatic enqueue. Invalid linkage blocks. Not a single atomic filesystem transaction or exhaustive machine power-loss proof. |

The earlier blanket refusal of budgeted native jobs is superseded for supported broker paths. Broader token budgets and complete continuity remain partial until private/native side paths and the live/Windows checks are covered. Native OS containment is still an engineering gap, not merely a credential blocker.

## Native containment and outage slice — 2026-10-10

| Capability | Current status | Remaining proof or capability |
| --- | --- | --- |
| Whole Hermes/OpenCode crew containment | Implemented; protocol/policy verified offline | Actual Docker kernel check and supported native CLI/provider task on Windows. Installed approved immutable image/Node20+/CLI/offline dependencies required. No host fallback or direct network. |
| Fixed native input exposure | Implemented and verified offline | Hash-validated input copy omits Git metadata and cannot gain later host files. Real Windows mount/permission behaviour still needs kernel verification. |
| Native file checkpoints across outages | Implemented and verified offline | Model-boundary/10-second snapshots, flush-before-pointer, explicit same-owner retry, restarted Home retrieval, integrity/conflict refusal. Physical power-cut and Windows directory-flush behaviour unverified; uncheckpointed changes can be lost. |
| Native runtime diagnostics | Implemented and verified offline; actual Linux UI verified | No model call, image pull or host CLI fallback. Real selected image/kernel/version check is environment-dependent and not yet passed here. |
| Container-safe MCP/browser access | Implemented and verified offline through the existing actor/run-bound Orbit MCP gateway | Real Hermes/OpenCode client compatibility and live browser/managed permission/cancellation proof remain unverified. Fixed owning-actor endpoint; no host gateway token in child, no arbitrary URL/header/actor, reviewer writes refused. Direct network/dependency downloads remain blocked. |

The native-worker OS boundary now has an implementation; earlier blanket descriptions of it as absent are superseded within this scope. It is not verified OS enforcement without a real daemon. Broader application containment, native private-session databases, cross-provider conversion, non-Node QA and product/planning/router gaps remain open.

### Windows kernel diagnostic evidence — 2026-10-10
The user reported a successful standalone real Docker Linux29.5.3 check on Windows using immutable image sha256:8f958bdc1b4a422bfafd97cab4f69836401f616ae985d4b57a53d254f5bcb038: all10 kernel/filesystem/network checks passed. Earlier statements that no real Docker check has passed are superseded for this tested configuration. This is user-reported evidence, without an exact checkout SHA; real Hermes/OpenCode availability/task execution and production MCP/browser/managed/recovery/power-loss behavior remain unverified. No code/test changes, installation, image pull or paid provider call accompanied this evidence update.

Both selected native CLI diagnostics failed on the user's installed image with the old generic error. CLI presence/version remains unverified. Diagnostic output now distinguishes missing executable, failed/timed-out version command, unsupported version/Node and isolation failure, preserving known boolean evidence and rejecting incomplete reports. Repeat on the refreshed isolated verification checkout; do not infer a missing executable or install packages from the old generic result.

### Selected CLI availability confirmed — 2026-10-10
User-reported diagnostic on refreshed checkout faa4a8e: Hermes and OpenCode both cliFound=false inside selected immutable image sha256:8f958bdc1b4a422bfafd97cab4f69836401f616ae985d4b57a53d254f5bcb038; all ten isolation checks and supportedNode passed. Neither selected executable is discoverable through the runtime's fixed container PATH. This supersedes the previous unknown reason, without implying either CLI is missing from the host or every image location. A reviewed pinned CLI runtime image is required before native integration checks; installation/build permission has not been assumed.

### Candidate native runtime recipe — 2026-10-10
Build tooling now prepares the missing CLIs in a separate Linuxamd64 image: pinned Hermes commit/Python3.14/uv/OpenCode release with artifact checksums, frozen application dependency lock, fixed-PATH wrapper and existing contained diagnostic. This is implemented but image build/native startup/task/MCP behavior remains unverified; no dependencies installed while preparing it. See containers/native-runtime/README.md for consent, scope, offline evidence gates and limitations.

First actual Windows runtime-image build (checkout de6c019) failed at Hermes project wheel generation: upstream setup.py blocks wheels outside Nix. Verified artifact download and pinned source steps completed. Recipe corrected to frozen dependency-only --no-install-project with the existing source wrapper; upstream build guard remains intact. Corrected image build and following native checks still require user-machine execution.

### User Windows native CLI/isolation PASS — 2026-10-10
Both required contained runtime checks now pass on the user's built runtime candidate: Hermes0.21.6/upstream818c13be and OpenCode1.18.35, all isolation/availability/Node booleans true. Candidate short ID80eebf6352fc; full immutable ID not printed in supplied output. Availability/kernel diagnostic gap is closed for this candidate only. scripts/native-task-check.js now prepares the next real-CLI task/MCP/checkpoint check with a local deterministic model and disposable Home; no real model API/billing/approval/recovery proof is claimed. See containers/native-runtime/README.md.


### 2026-10-10 — Actual Windows native task failure and checkpoint flush fix
The user ran scripts/native-task-check.js after updating to b0aaede on Windows Docker Linux29.5.3 with candidate sha256:80eebf6352fc1290a6ed7111803007b921d303855008a800abf2c0a70682148a. Both engines failed at native_task with EPERM: operation not permitted, fsync; Hermes made zero synthetic model requests, OpenCode one, and neither made an MCP call. Earlier CLI/isolation PASS remains valid; task/MCP compatibility is not established.

Checkpoint regular files were opened read-only before fsync. Windows FlushFileBuffers requires GENERIC_WRITE (Microsoft API documentation); changed only these regular-file handles to r+ without truncation. Mandatory file flushing remains fail-closed. A regression also found queued protocol frames could continue after the first checkpoint error: the existing frame processor now rejects further frames after failure/closure, preventing queued broker or MCP actions. Offline regressions reproduce the original Windows handle requirement and prove a file flush failure prevents checkpoint publication, broker submission and candidate application.

Focused checks:31/31; expanded Node suite:567 total,564 pass,0 fail,3 real-Hermes skips. JavaScript syntax checks pass. These are remote offline fixtures, not a Windows retest. Update the clean verification checkout and rerun native-task-check.js with the same immutable image; no rebuild/install/provider call is needed for this host-side fix. Physical power-loss/directory durability and production provider/budget/approval/crash evidence remain separate.


### 2026-10-10 — Post-flush real native task failures and safer diagnostics
User updated to6bbd6bb and reran the same installed sha256:80eebf6352fc1290a6ed7111803007b921d303855008a800abf2c0a70682148a candidate. The prior fsync EPERM no longer appears; Hermes fails with generic Isolated runtime failed (zero synthetic model requests), OpenCode reaches one synthetic model request but does not expose the read_fixture MCP tool, and neither executes an MCP call. This establishes new blockers, not native task/MCP PASS or power-loss proof.

Runner now returns405/Allow:POST for authenticated optional MCP GET/DELETE on the existing stateless relay and disables OpenCode OAuth for the fixed token-authenticated local server. Earlier400 behavior was a protocol compatibility gap; whether it caused this specific discovery failure remains unverified. Actor/run authentication, POST-only forwarding, no direct network and other bounds stay enforced. No speculative Hermes dependency/install fix is applied without actual failure evidence.

Only fixed runtime phase/error-category diagnostics are returned, never native stdout/stderr logs, paths or secrets. Offline task reports bounded known MCP methods/HTTP status/tool counts and model function/fixture counts, without tool arguments or model bodies. Hermes native startup root cause still needs the refreshed real diagnostic; remote Docker/CLIs are unavailable.34 focused offline checks and five syntax checks pass. Update the separate clean verification checkout and rerun the same task script; runner is read-only mounted, so no image rebuild is needed.

Validation follow-up: expanded Node suite570 total/567 pass/0 fail/3 real-Hermes skips (43.4 s); npm test528 total/525 pass/0 fail/3 skips (40.4 s). These are offline fixture regressions, not native Docker task PASS.


### Native readiness follow-up — 2026-10-10
Actual Windows6a29d22: Hermes completed initialize/initialized/tools-list (12 tools) but failed at hermes_health, with no model requests or tool calls. OpenCode only initialized; its model request had zero tools, with no MCP execution. The previous fsync failure is cleared in this run; complete native task compatibility remains open.

Pinned Hermes gateway/run.py load_gateway_config_for_runner defaults to multiplex mode and reloads secrets under the default-profile scope; agent/secret_scope.py suppresses environment credential fallback there. Orbit's generated API_SERVER_KEY exists only in the isolated process environment. Correct the configuration mismatch with explicit single-profile mode, appropriate for an isolated one-worker home. Actual startup/task success is not inferred from source inspection.

OpenCode now performs its native offline MCP readiness check before task submission, requiring fixed Orbit connected status even if the CLI exits successfully. It blocks silent missing-MCP generation; it does not establish the cause of the reported initialize-only failure. Safe fixed failure/status categories and numeric health/exit details make the next Windows result actionable. The installed SDK completes real loopback handshake/discovery/read_fixture through production relay code locally; selected OpenCode1.18.35 and Hermes0.21.6 task/provider compatibility still need the installed-image retest. No dependency/image rebuild or containment relaxation.


## Native task fixture and relay correction — 2026-10-10

- Actual Windows e43ea1f result remains FAILED for both engines: Hermes alive without health response; OpenCode readiness connected but task fixture stopped on a zero-tool request. No native task, provider or approval PASS.
- Pinned OpenCode runs a separate title-generation request with no tools. The fixture now recognizes only its bounded known title pattern, returns a synthetic title, and counts task evidence separately. All other missing-tool requests still fail; title generation never satisfies MCP/result/file evidence. Its involvement in the actual Windows failure is plausible, not yet proven by a successful retry.
- A held broker request reproduced a real relay defect: concurrent MCP returned400. The relay now admits at most8 requests, rejects excess with429, and preserves serialized host processing, checkpoints and failure latch. Offline regression passes; native compatibility remains pending.
- Hermes startup diagnostics project fixed states/milestones from bounded regular private logs/state; raw logs and unknown strings cannot cross the boundary. The host independently validates the projection.
- Recipe gap: upstream API server requires aiohttp; the original web/mcp/pty/cron extras do not explicitly provide it and import alone tolerated absence. Add the pinned upstream sms extra (aiohttp dependency only; no SMS service enabled) and assert API-server requirements in offline build smoke. Existing image dependency availability remains unverified; a new image is not built automatically.


## Windows Hermes API dependency confirmed missing — 2026-10-10

User executed the hardened offline dependency probe on immutable image sha256:80eebf6352fc1290a6ed7111803007b921d303855008a800abf2c0a70682148a. Python failed at import aiohttp with ModuleNotFoundError. Missing API dependency is now observed evidence, not a hypothesis; it is a startup prerequisite blocker, not proof that every Hermes startup failure is resolved. Corrected frozen extras and API requirement assertion were published in99c5a24/758c78f. Next action: update the separate Windows verification clone, explicitly build the reviewed candidate image, retain its new immutable ID, then rerun CLI/isolation and actual deterministic native-task checks. Downloads/install occur only inside the candidate build. No paid provider or original application/settings modification. Both native tasks remain unverified/failed until actual retest. No new code changes or redundant suite rerun for this evidence-only update.


## Actual Windows OpenCode task PASS; Hermes deferred-tool fixture — 2026-10-10

- User updated separate verification clone to5639e16 and rebuilt reviewed image successfully. New immutable ID: sha256:018544b25065b555d1a913373bc8164eebe0280794ec8ae92fbfed6acab4e6d8. Both engines passed all15 CLI/isolation checks; offline build API dependency assertion passed.
- OpenCode real contained native task PASSED all6: native response, owning-actor MCP, model received tool result, unchanged input, saved checkpoint and stopped container. Actual MCP tools/call200 observed. Three deterministic model requests comprised2 task +1 title. This verifies this offline task only; no live provider/billing/human approval proof.
- Hermes API health now200, gateway running/api connected and MCP registration observed. Startup dependency blocker cleared in this run. Task still FAILED:17 exposed functions,0 direct fixture names,1 deterministic model request,0 MCP calls. Do not claim Hermes task PASS.
- Pinned Hermes818c13be tools/tool_search.py defaults MCP deferral on: model sees tool_search/tool_call bridges instead of direct MCP names. Original diagnostic demanded an eager fixture schema and falsely rejected this supported surface. Fixture now requests bounded native search, validates one scoped mcp__orbit__read_fixture catalog match with no required arguments, then invokes the real native tool_call bridge. No invented catalog, marker or MCP result. Wrong server, missing evidence, required arguments, repeated bridge without execution and absent actual marker all fail. Actual Windows bridge compatibility remains pending.
- Production engine/tool discovery settings and permissions are unchanged. No image rebuild required for this mounted diagnostic correction. Keep resource/network/actor/run/checkpoint/approval controls.


## Both real contained native offline tasks PASS on Windows — 2026-10-10

User updated verification clone to30a1e46 and tested immutable image sha256:018544b25065b555d1a913373bc8164eebe0280794ec8ae92fbfed6acab4e6d8. Hermes AND OpenCode report ok:true and all6 acceptance checks true: nativeResponse, owningActorMcp, modelReceivedToolResult, unchangedInput, checkpointSaved, containerStopped. Both show actual MCP tools/call200. Hermes health200, gateway running/api connected;3 task model requests exercised native tool_search/tool_call (17 exposed functions,0 eager fixture names). OpenCode3 model requests comprised2 task +1 title, task-session initialize/initialized/tools-list/tools-call successful. Earlier missing aiohttp packaging, auxiliary-title fixture and deferred-tool fixture blockers are resolved for this specific diagnostic.

Scope: real contained native CLI plus deterministic local model, existing owning-actor MCP, file checkpoint and confirmed container stop. No live provider, real billing, production native budget, human approval, browser, cancellation/crash/power-cut or private engine-history restoration proof. Hermes startupMilestones.gatewayRunning:false is an earlier bounded log observation; it does not override gatewayState:running, health200 or final stopped-container evidence. Do not infer a new failure from that snapshot. No source change, install or redundant test run needed for this evidence update. Keep draft PR, original application and production settings untouched. Next integration evidence should use existing test/approval/budget/recovery services rather than duplicate infrastructure.


## Crew YAML v1 — 2026-10-10
Implemented: versioned configuration-only export/import, strict bounded schema, fresh revision/diff, explicit trusted UI apply, preserved credentials/permissions/runtime records, existing Home/Library writes, durable partial-import inspection and execution quarantine. No external framework or parallel source of truth. Tested scope and limitations are recorded in project-update.md.
Remaining for this pattern: YAML worker creation/deletion/role/teams; desired-state lifecycle reconciliation and hierarchical delegation. Physical Windows power-cut/multi-file durability and external-writer races remain unverified. Live provider, budget/approval and full continuity gaps above remain separate.

Interrupted YAML imports now reconcile current persisted public worker configuration against intent hashes and display applied-match/unchanged/partial/drift/missing/unknown outcomes plus independent journal progress. Base/current revisions and document hash are shown; no replay/automatic rollback. Explicit inspection still required. Five-worker abrupt process-exit recovery is tested; safe automatic rollback, protected full-state snapshots and physical Windows power-loss proof remain gaps.

Reviewed rollback now covers one original incomplete YAML import's public settings/assignments only. Strict intent hashes, current-value checks, fresh revision + history-bound preview, catalog/default validation and idle gates refuse drift. Linked reversal intent precedes writes; original and reversal resolve together only after readback. A failed terminal flush or abrupt process exit retains quarantine. Full protected-state snapshots, automatic rollback, physical Windows power-loss and external-writer guarantees remain outside this implementation.


## Advanced planning, native routing, visible continuity and Python QA — 2026-10-10

Existing project cards/Home/Library/job records, provider adapters, budget broker, trusted IPC and QA services remain authoritative. No new framework or copied external implementation.

- Laila accepts bounded supplied business estimates, success criteria and unknowns; over-budget/impossible optimistic deadline constraints block dispatch. This is not market research or verified feasibility. Role/skill recommendations remain proposals. Missing skills reuse matching existing workers before provisioning. Fresh per-action human permission gates a revision-bound staffing proposal; newly created workers have code access disabled, no automatic jobs. Persist intent before Home/Library changes; report observed worker existence, skill assignment and step linkage independently of saved progress. Incomplete staffing blocks replay/dispatch until fresh approved inspection acknowledges actual state. Multi-file staffing is not transactional or a complete rollback; physical outage and external writers remain unverified.
- Free-form contradictions use Laila's proposed explanation plus two different bound report hashes/exact quotations. Missing/stale quotes fail. Findings append, empty analysis cannot erase conflicts, changed reports invalidate old human resolutions. This strengthens evidence binding, not semantic contradiction-detection accuracy; live Laila analysis remains unverified.
- Optional native worker routes support Gemini/OpenAI/Anthropic count-capable adapters, authenticated bounded model catalogs, explicit text/tools capabilities/context limits, entered prices, allowlists and protected per-provider keys. Rank entered input+output rates, not a proven task-cost optimizer. Catalog fallback occurs before generation; existing histories pin route/policy. Counted input plus reserved output enforces entered context. No replay/failover after unknown generation/billing/tool effects. Catalog availability is not generation health; capabilities/prices are configured declarations. Other providers, catalog pagination, automatic pricing, task-quality benchmarking, commander/voice and complete built-in routing remain gaps.
- Trusted Office preview/apply/cancel can explicitly convert stopped jobs' visible broker histories between the three adapters. Bind history/run/status/budget/decision/permission evidence; preserve encrypted source archive, paired tool IDs and original budget. Unknown requests, pending tool effects, opaque thinking/signatures/annotations, stale preview and unpriced target reject. No automatic retry or restored grant. Private native session/plugin/database/TODO state is not restored. Native runtime still uses temporary engine homes. Pinned Hermes private-state tree retrieval failed; OpenCode v1.18.35 source shows database-backed TODO/session state. No unverified raw database copy/import was added. Version-pinned supported export/restore, live CLI compatibility and actual crash restoration remain pending.
- QA supports explicit selected JavaScript files or Python stdlib unittest files, never mixed runners. Fixed runner/arguments, fresh human approval, minimal environment, existing timeout/cancellation/output bounds and exact project revision checks; no shell/custom commands/install. Empty, skipped, failing and ordinary forged printed summaries cannot pass. Host QA executes project code as the OS user; it is neither containment nor tamper-proof against malicious code. Pytest/Rust/Go/Java and arbitrary build/test commands remain unsupported.
- Newly configured independent reviews require schema v2: candidate/goal hashes, satisfied goal assessment/rationale, unique source-file hashes/exact quotes/check reasons and coverage of every requested output. Human acceptance and host tests of the exact candidate remain separate gates. Legacy configured reviews retain prior schema. Exact quotes establish source inspection evidence, not semantic correctness. Offline reviewer fixtures are not live independent model evidence.

Validation: npm 583 total / 580 pass / 0 fail / 3 unavailable-real-Hermes skips; focused QA/router19/19 and planning11/11. Actual Linux Electron44.4.3/Playwright16/16, zero renderer exceptions, including Python approval/test evidence, routed Settings save/unsupported-provider rejection and prior YAML recovery/rollback. No live provider/billing/native CLI/Windows/private-history restore test this turn. Earlier user-provided Windows native offline PASS remains scoped to its original image/task.

### 2026-10-10 — bounded private native working-state recovery
Implemented, offline verified: existing workspace checkpoint v2 includes a protected, actor/job/run/root/image/provider/model-bound native database payload. Pinned Hermes0.21.6 adapter preserves state.db active session/messages/tool-result TODO history and MEMORY.md/USER.md; pinned OpenCode1.18.35 adapter preserves SQLite session/message/part/TODO state. SQLite online backup includes committed WAL, never an unsafe sidecar copy. Exact native session is reopened (`X-Hermes-Session-Id` / `--session`), with current regenerated configuration and credentials. Saved permissions, queued inputs, routing/lease/heartbeat state are removed from the copied database and vacuumed; source stays unchanged. Unknown tool effects/background delegations block resume, not replay. Protected broker history can safely supply a missing committed tail when the native snapshot is a strict prefix followed by one fresh user request; divergence blocks.

Workspace/private payload publication is one existing flushed snapshot-before-job-pointer protocol; incomplete private transfer cannot publish a workspace-only pointer. Restart requires owned Docker cleanup and explicit retry. Engine/image/provider/key-store/conflict/integrity checks precede workspace restore. A trusted visible-history conversion explicitly archives the old checkpoint and resets private session; it does not convert a private database across engines/providers.

Remaining verification: real installed native private-session/TODO compatibility using `native-task-check.js IMAGE --private-continuity`, Windows OS protected store, cancellation/power-loss/directory durability and adversarial crash schedules. Local tests exercise actual SQLite WAL and disk reload, with simulated container protocol and ephemeral encryption, not actual local Docker/native CLI. Arbitrary plugin code/private plugin databases, response/idempotency caches, cron files, auth/config/cache/logs and private cross-provider history conversion are deliberately outside this adapter. Native unresolved effects currently require inspection; an automatic database repair/replay path is not provided. Workspace and SQLite are coherent individually, not a transactional snapshot across a simultaneously changing engine and filesystem.

Owner's acceptance clarification: a coherent SQLite backup is not proof the native CLI resumed it, nor that filesystem/database changes were one application transaction. Seven separate real-Windows gates are recorded in docs/user-verification.md: original Hermes context, OpenCode ID/TODO, cross-state crash consistency, grant/key/queue retirement, mismatch denial, uncertain-effect no-repeat, and Guardian/approval/budget enforcement. Production safeStorage never writes a plaintext checkpoint decryption key to Home; Windows key lifecycle remains unverified. Optional fixture restart uses an ephemeral memory-only key and is not DPAPI proof. Native TODO command recognition and full recovered production-broker policy must not be inferred from that diagnostic's history/session result.

### Real Windows private restart attempt — failure, not acceptance
Owner updated checkout30a1e46→481094b and ran the private-continuity option on approved image018544b. Both initial native tasks executed one MCP fixture call. Hermes failed during resumed model request4 because previous marker was absent; OpenCode failed at resumed MCP initialize401. These are real failures of the new restart diagnostic; prior ordinary task PASS does not establish restoration.

Follow-up: diagnostic regenerates the actor gateway token after starting the new job generation (old token stays invalid; no authentication relaxation). Hermes private capture now addresses the exact request-owned stable session ID from the first private run, rather than selecting an unrelated newest API row, and requires the API to acknowledge that ID. Restored helper validates the selected saved ID even if another API row is newer. Resumed diagnostics expose only message/tool counts and marker-presence boolean, update actual resumed phase, and distinguish native_resume failures. Offline regressions verify token rotation/old-token rejection and exact selected-session capture/restore. Actual Windows Hermes context/OpenCode restored session retest is still required; the absent marker's precise cause is not conclusively established by source review alone. No image rebuild, new install, live model, copied upstream code or widened permissions.

### Windows c6b3949 evidence and initial Hermes header correction
Owner's real OpenCode private restart now passes all10 checks on approved image018544b: native response, owning MCP, model received result, unchanged input, checkpoint, stopped initial container, saved/restored same private session, prior history reached model and stopped retry container. Resumed model had6 messages including1 tool message and prior marker=true; MCP initialized with200 after generation-token refresh. This is real installed native CLI/private session/context evidence with local deterministic model/ephemeral encryption; no native TODO-command/OS-store/physical-power-cut/live-policy proof.

Hermes remains failed at initial native_task, request4, MCP calls1, and no resumed history diagnostics. The follow-up had introduced an explicit session header on the first request; pinned upstream source says that enables wake-capable session history delivery. Fresh private requests now retain original headerless behavior and adopt the validated session ID from the authenticated API response; resumed requests supply and require acknowledgement of the saved ID. Capture still targets the exact owned ID, never an unrelated newest row. This removes the introduced initial-header behavior change, but precise request4 cause and real resumed Hermes success remain unverified. Diagnostic bounded per-request counts/booleans distinguish initial from resumed history without outputting transcript/IDs/credentials. No evidence threshold was relaxed.
