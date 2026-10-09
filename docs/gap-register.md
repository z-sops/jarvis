# Orbit gap register — 2026-10-09

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
