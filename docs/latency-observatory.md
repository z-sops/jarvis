# Latency observations and acceptance

These are instruments, not established Orbit speed claims. No live provider latency benchmark has run during development. Targets such as 1-second acknowledgement /3-second useful reply remain goals.

Reuse existing request, jobs, provider, tool, containment and benchmark paths. No framework, worker pool, scheduler, warm-container reuse, provider change, automatic retry, new authorization or billing added.

## Recorded boundaries

| Metric | Boundary and limitation |
| --- | --- |
| Commander elapsed /response_ready | Main-process commanderTurn entry through reply-ready return. Includes pre-routing, model waits and tools, not user click/IPC transit/renderer paint or whole delegated project. Slash/offline replies separated from traces with provider spans. |
| Renderer feedbackMs | Existing Thinking/presence update from typed handler entry. Visual feedback, not Laila's textual acknowledgement. Renderer-reported, trusted frame, bounded, one report per known request. |
| Renderer replyDomMs | Typed handler entry through backend reply, addMsg and DOM update. Includes IPC and host work, not guaranteed next paint or semantic usefulness. Voice and automatic crew-report messages not instrumented by this typed handler. |
| Worker elapsed | Enqueue through settled engine/report/cleanup path; queue/dependency wait included. Report ready is NOT human acceptance. Random parent request ID correlates delegation without storing task text. |
| worker_started /engine_submit | Scheduler starts run /adapter invoked after preparation and native preflight. Host milestones, not provider generation or first side effect. |
| container_create | Existing Docker check/input preparation/create/verify. Does not by itself mean CLI ready. |
| native_startup /startup_ready | Execute entered through authenticated native runtime's Hermes/OpenCode task phase. Includes CLI initialization/health/MCP. Missing ready phase means startup duration is excluded from percentile summary. Runtime phase is an observation, not independent readiness proof. |
| model_request | Host provider HTTP submission through response body consumption (including failure). Gemini/native broker buffered response; NOT first token/stream to user. Token-count requests recorded separately. Router availability discovery outside these boundaries remains unattributed. |
| tool /first_action | Host tool call interval includes policy/approval; first_action marked only immediately before authorized implementation invocation. Does not prove successful side effect. Native engine progress has separate first_tool_progress; not treated as verified execution. |
| approval_wait | Human approval wait, separate nested span. Never classify human delay as provider overhead. |
| checkpoint | Native durable publication including fsync/encryption/metadata/job pointer. Transfer/manifest receipt and all other builtin checkpoints are not entirely covered by this boundary. |
| private_restore | Existing private/workspace restore helper. Native resume fixture separately measures fresh Home/recover/restore/new container/model/checkpoint/cleanup; recoveryMs is result-after-recovery, not pure SQLite load time. |
| model_relay /gateway_relay | Contained engine's round trip to existing host broker/MCP. Includes policy/provider/permission/service work; do not count again as raw provider time. NeuralOps remote-server scheduling is not independently instrumented. |
| retry_wait | Existing Gemini backoff; no retry behavior changed. |

There is no warmed contained worker path: production currently creates fresh contained execution. Warm metrics remain unmeasured; no persistent privileged worker introduced. Full user goal → all workers → independent QA → human acceptance E2E remains a separate acceptance gate.

## Statistics and storage

Monotonic performance clock, one-shot marks; nearest-rank p50/p95/max with sample count. Separate trace kind, engine, outcome and provider-span coverage. Missing metrics absent/null, never zero. Incomplete span coverage excluded from span percentile statistics. Successful and failed/cancelled work are never blended. Different workloads/providers must be benchmarked separately: engine grouping alone does not make arbitrary tasks comparable.

Spans can overlap: token counts, tools, approvals, relays and provider wait are NOT additive. Each category reports count/sum/union; unattributed elapsed is remaining wall time after union of measured intervals. It is NOT a claim of pure Orbit orchestration overhead. Proper exclusive attribution across parallel work/services still pending.

Bounded500 recent in-memory trace summaries, max512 intervals per trace. Main-process restart loses commander/renderer window. Existing queued worker job records receive one bounded summary after settlement; no separate authoritative database or event ledger. Extra record/event bytes are measurable by Storage Guardian. Direct exported workers.run compatibility is retained with an isolated ephemeral trace; durable summaries are produced by the queued path. No prompts, model keys, URLs, raw errors, tool arguments, transcript or output content in latency records. Read-only latency IPC requires trusted main frame. Renderer metric fields are diagnostic attestations, never security/budget approval evidence.

Readonly saved worker report:

```powershell
node 'G:/jarvis-containment-check/scripts/latency-report.js' 'YOUR_ACTUAL_ORBIT_HOME'
```

This CLI does NOT call Home.ensure, start providers/jobs or write files. Bounded complete job inventory required; unknown/large inventory refuses. Reports last500 recorded workers, not commander/UI/NeuralOps history. Confirm actual Home path in Orbit settings; do not substitute test checkout path.

## Native storage fixture

Existing native-storage-benchmark report now includes latencySamples, latencySummary and recoveryLatency. Same approved immutable image, deterministic LOCAL model, actual installed CLIs and disposable Home. Initial native fixture and recovery traces have separate classes. Initial fixture elapsed includes its nested restart, so do not compare it to a simple one-turn task. Fake local model timings are NOT Gemini/Claude/OpenAI provider benchmarks. `recoveryMs` includes a subsequent deterministic task and cleanup. Shared storage-check callback now forwards jobId AND required bytes (earlier harness callback omitted them); production containment unchanged.

Run the one-job Windows smoke in [native storage instructions](native-storage-benchmark.md), then separate100-task cases for both engines and1/5 identities. Sequential round-robin is not parallel throughput. Actual owner latency numbers remain pending.

## Verification boundaries

Offline regressions cover monotonic intervals, nearest-rank stats, overlapping spans, async isolation, bounds/late callbacks, missing metrics, provider body/failure timing, queued worker persistence/correlation and bounded one-use renderer records. Real Linux Electron tests cover trusted preload/IPC and an OFFLINE response with synthetic renderer timing values; no live model/latency target PASS inferred. Earlier recovery/storage test times are not converted to user-experience speed claims.
