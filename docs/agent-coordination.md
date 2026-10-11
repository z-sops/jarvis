# Agent communication and scoped coordination

Orbit extends its existing tags, project cards, job queue and MCP gateway. It does not add a second scheduler, worker database, remote message bus or human approval source. `lib/comms.js` remains the separate Telegram/WhatsApp/email channel hub.

## Reliable local messages

The built-in tool path and authenticated native MCP gateway expose:

| Tool | Behavior |
| --- | --- |
| `send_agent_message` | Persist a question, answer, finding, risk, context or handoff note for an exact related worker job, or the assistant. |
| `agent_messages` | Poll the current job's inbox and its own sent receipts. |
| `ack_agent_message` | Explicitly record receipt for the current receiver run. |

Worker identity comes from the host's active actor/job/run, not arguments. Worker-to-worker messages require an existing shared project or job dependency relationship. `target_job` must identify a queued, running or interrupted job owned by the named receiver. A message does not start/resume a job, execute instructions, accept an artifact, resolve a contradiction or transfer NeuralOps task ownership.

Each sender job supplies a stable `idempotency_key`. Retrying the exact body returns the original receipt, including after the target has finished. Reusing the key with different content refuses. `reply_to` must bind the actual communicating job pair. Receipt means received, not accepted or authorized. Persisted timestamps enforce 20 new messages per sender/receiver in ten minutes, across module/process restart.

Messages use schema version 2 in the existing `tags/<receiver>.json`. Publication and acknowledgement use the existing atomic, flushed job-storage writer. Legacy `tag_agent` and final-report NOTE lines retain their separate semantics: reading a note is not a reliable acknowledgement. Reliable messages are never dropped by the old 60-note cap. A receiver inventory is bounded to 200 reliable receipts plus 60 legacy notes / 1 MiB; full inventories refuse new messages. No automatic receipt pruning or infinite-retention scalability claim is made.

Corrupt, unknown-schema, oversized and linked inventories refuse operations. Payload hashes detect accidental changes; they are not authentication against an OS user who can rewrite both data and hashes. Actor/job/run authorization is enforced through the existing tool and native gateway paths; managed jobs also pass the existing NeuralOps Guardian argument checks. Local receipts do not claim remote delivery, remote acknowledgement or a NeuralOps ledger commit.

After an interrupted job is explicitly retried by the existing job controls, its verified same-owner retry chain can read and explicitly acknowledge the predecessor's messages. Both source/child pointers and `retryLinkReady` must agree; at most ten generations are traversed. No startup delivery loop, uncertain action replay or automatic worker restart is introduced. Sender receipts are polled while that job or its verified retry is active. Deleting a worker/inbox externally is not recoverable by this layer.

Durability is scoped to the existing single Electron main-process writer and atomic filesystem publication. It does not establish cross-machine delivery, OS-wide locking, physical power-failure guarantees or two external processes safely sharing the same Home. Native engines must actually call the polling tools; push delivery into an already-running model response is not provided.

## Optional Team Leader

1. Create a normal structured project with an existing `teamLeader`.
2. `get_coordination_scope` previews the exact undispatched steps, worker assignments and revision.
3. `start_project_coordinator` requires fresh per-action human permission for that exact revision. It dispatches the leader through the existing queue and links the finite grant before execution starts.
4. The authenticated coordinator uses `get_team_plan` and `delegate_team_step`.

Worker recommendations are pinned at approval so queue-load changes cannot reroute delegation. The grant binds the project configuration, leader, selected workers and their skill assignments/configuration. Task/configuration changes, missing workers, stale runs, paused/stopped coordinators and other projects refuse delegation. The coordinator must be separate from the workers on undispatched steps. Only recorded ready steps may run, once; accepted dependency artifacts, skills, permissions, storage admission and human review use the existing paths.

A coordinator cannot create workers, enlarge its own scope, accept results or resolve contradictions. Generic coordinator retry is refused; a fresh approved scope is required. Already dispatched child jobs retain their own ownership/lifecycle when the coordinator stops. This is finite delegated execution, not a persistent team supervision daemon or an aggregate team-budget guarantee.

## External discussion foundation

`prepare_external_discussion` creates an **offline** project-bound draft for `chatgpt`, `claude`, `kimi`, `qwen` or `deepseek`. It contains a bounded question, the project goal and at most five explicitly selected existing project reports, with source hashes and truncation labels. No credentials, environment, entire workspace, private database or automatic provider call is added. Selected goal/report text itself may contain sensitive data: inspect the draft before manually sharing it. There is no claim of automatic secret redaction.

`record_external_reply` records manually supplied text against an unchanged scope hash. Duplicate identical replies are idempotent; changed evidence or conflicting replacement refuses. The origin is unverified external text, not a verified provider identity. Replies never grant approval, unblock dependencies, resolve project conflicts or run tools.

At most 20 drafts per project are retained, with 4,000-character questions, 4,000-character excerpts per report and 8,000-character replies. User-defined live provider transport, share/approval UX, round limits, spend limits and collaboration flow remain pending. No ChatGPT browser session, Claude account or paid endpoint is contacted by this increment.

## Verification boundary

Regression tests cover fresh Home/module persistence, duplicate delivery, explicit acknowledgement, related-job scoping, stale actor/run denial, verified retry lineage, changed/corrupt/linked inventory, bounded rate enforcement, exact reply pairing, parent-forced sender termination after publication, finite delegation, approval refusal, actual existing queue linkage and inert external text.

Full project-building E2E, Windows/native polling/delegation, remote NeuralOps typed-message acknowledgement and live external collaboration are deferred to the owner's E2E testing phase. The offline regressions do not establish live model coordination quality or provider compatibility.
