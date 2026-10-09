# Managed job outcome reconciliation

Managed built-in jobs save a remote delivery intent in the same atomic job
record as review, failure, cancellation, startup interruption or human review.
Ordinary jobs do not acquire this queue. Stop/restart never sends the queue or
replays a job automatically.

Office shows pending/unconfirmed/recorded delivery separately from local job
status. Use **Sync NeuralOps outcome** to reconcile a recorded managed outcome.
The main-window-only IPC honors connector blocked/ask/free levels and checks the
stored connector, upstream worker identity and run around awaited calls.

Both applications must include the outcome protocol. Refresh the connector's
tool discovery after updating NeuralOps. The server must advertise
`jobOutcomes: orbit-v1` and expose `neuralops_job_outcome` and
`neuralops_job_receipt`. Missing capability or operations fail closed.

Each queued event has a fixed act ID. Sync reads its receipt before submission
and confirms the exact identity, payload and ledger hash afterward. A lost
response leaves delivery unconfirmed; a later explicit Sync uses that receipt
instead of submitting a second event. Concurrent Sync requests in one main
process share the same operation. Receipt updates reread the job so that a
concurrent human acceptance/rejection cannot be discarded.

Outcome messages include job/task/run IDs, sequence, state, file-check status,
report/manifest SHA-256 hashes and artifact count. They contain no report body,
artifact content or approval credentials. Hashes are client claims, not remote
attestation of file correctness.

NeuralOps records the outcome as unverified and blocks the task for separate
reconciliation. Local acceptance is explicitly `accepted_locally`, reported by
the worker identity. This operation never creates a remote human approval,
verified evidence or completed task. Existing remote completion policies remain
separate; this protocol is not a universal completion security boundary.

Limits: explicit Sync, no automatic queue delivery; no migration of old finished
jobs without outcome records; no receipt for a bootstrap that failed before its
task binding was saved; changes to ownership/task state require manual remote
reconciliation. Live server, Windows and external engine behavior remain subject
to separate verification. Managed Hermes/OpenCode and shell remain unsupported.
