# Team Workspace and bounded controls

The existing project cards, job records, reservation evidence and tags remain authoritative. Settings → Team Workspace observes team state every five seconds while open. It does not restart workers, create schedules, approve artifacts or replay uncertain actions.

## Shared team budgets

A human previews and applies a bounded token/USD policy to an idle project. Laila's `get_team_state` observes the same records; `set_team_budget` requires fresh per-action permission and the exact state revision. Policy changes invalidate finite leader grants and previously configured continuations rather than silently changing their accounting.

Built-in and native reservations are checked synchronously against the complete bounded durable job inventory before publication/submission. Unknown reservations stay charged. Measured usage replaces the pessimistic amount. Retries count an inherited reservation once only when persisted same-owner parent/child pointers, parent `retried` status and child `retryLinkReady` agree. Conflicting evidence refuses work. Provider overage is persisted truthfully and blocks further reservations; Orbit cannot guarantee that an upstream provider honors its advertised output cap.

This is a single-main-process budget gate, not a distributed transaction or protection against another process modifying Home. Inventory bounds can refuse large homes. Request-count caps remain per job; project aggregate policy covers tokens and configured USD rates.

## Communication inbox and retention

Office → agent drawer → Agent communication displays sent/received reliable messages and receipt status using text nodes. ACK remains a receiver's authenticated active-run action; human inbox inspection never impersonates the receiver or accepts its work.

Release is explicit, idle-only and preview-bound: acknowledged receipts, human-accepted terminal sender/receiver jobs, no pinned recovery, at least 30 days since acknowledgement and no retained reply referencing the selected message. Unacknowledged, active, interrupted, unresolved, missing, malformed or changed records are protected. One-use five-minute previews, at most ten pending previews and 100 receipts per batch.

A durable prepared intent precedes rewriting the existing inbox. Restart reports actual present/absent IDs and does not replay deletion. A user can preview precisely the remaining interrupted batch or explicitly finalize an already-removed batch. Actual inbox byte reduction is reported separately from intent overhead. No age-only database pruning or automatic retention. Orphan/deleted-worker inboxes are not automatically retired. Local receipts are not remote NeuralOps delivery/typed-act receipts or ownership transfer. Cross-process Home writers remain unsupported.

## External discussion

Team Workspace can prepare an exact local draft for ChatGPT, Claude, Kimi, Qwen or DeepSeek using a bounded question and up to five explicitly selected report excerpts. The user reviews the visible payload for secrets and shares it manually. A pasted reply is recorded as unverified inert text against the unchanged scope hash; it grants no permissions, resolves no conflicts and accepts no jobs.

Live multi-round API/browser collaboration remains unsupported until its detailed transport/account/data-sharing/round/budget flow is specified. Selecting ChatGPT does not imply an OpenAI API account or authenticated ChatGPT browser session. No provider calls occur in this feature's regression/UI checks.

## Router and storage guards

Configured Gemini/OpenAI/Anthropic catalogs support bounded pagination (10 pages, 2,000 entries, aggregate 1 MiB), credential-isolated cache, explicit context/capability requirements and input/output workload-weighted configured prices. Availability is catalog evidence, not generation health. Built-in execution selects Gemini routes only, records the public route evidence, pins retries and disables implicit model fallback for configured routes. Native generation still requires the existing exact count adapters; other providers need explicit adapters. Generation with uncertain effects is not automatically replayed.

The managed-write wrapper is explicit at existing Orbit-owned write/copy/append paths, not a global `fs` patch. It checks complete metadata coverage, configured Home quota, real free space, temporary full-write size and pending asynchronous writes before opening a destination. Atomic job-record writes may consume emergency headroom down to a 32 MiB floor. Refusal preserves the original before writing; this is not an atomicity guarantee for arbitrary later I/O failures.

Docker storage, external commands/native processes outside these wrappers, untracked OS writes and other concurrent Home writers remain outside this guard. It is not a universal hard filesystem quota, nor a guarantee against actual ENOSPC, physical outage or workload growth beyond inventory capacity. Per-write full metadata scans may add latency; measure that in the deferred real workload acceptance. Existing admission reservations and checkpoint retention remain in force. Protected recovery is never automatically deleted.

## Validation boundaries

Feature regressions and Linux Electron/Playwright exercise disposable records, explicit retention, team budgets and manual discussions. Owner requested complete-project native/storage/latency/live acceptance later. Real providers, remote NeuralOps receipts, nested team leaders, named/versioned private-plugin adapters, production key lifecycle, physical outage and beta packaging acceptance are not inferred from these tests.
