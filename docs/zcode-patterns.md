# ZCode execution patterns adapted to Orbit

This is Orbit's own implementation. No ZCode source files/frameworks were imported.
Reference audit: z-sops/zcode `fd313ae3d32db243e61af26fc0be4501584d4690`.

## Execution policy

OpenCode engine and OpenCode hosted provider are separate settings. An OpenCode
worker can use Gemini/OpenAI/Anthropic with existing exact counting, or the
explicitly selected OpenCode gateway model through request-limited mediation.
Both paths retain the existing local broker, actor/job/run fences, protected
keys/history, Docker boundary, Guardian/tool approvals and candidate QA.

`workerGatewayMode` is a global Settings policy, never a YAML worker import,
agent-written authorization or per-call model override. It defaults to `exact`.

| Choice | Execution | Guarantees |
| --- | --- | --- |
| `exact` | Existing verified token-count adapter and reservation path | Configured token/USD budgets remain enforced within their documented scope; unsupported counters refuse |
| `requests` | Opt-in for provider `opencode`, model `space-bunny-free` | Durable per-job submission cap and requested per-response output cap; provider-reported usage afterward; **no exact token/USD ceiling or free-price guarantee** |

Other providers retain exact mediation even when the OpenCode gateway option is
request-limited. No implicit provider/model fallback. Fixed official endpoint;
custom URLs cannot bypass this policy. Only the previously inspected Chat
Completions model is currently admitted. More gateway models need explicit
protocol adapters, not a suffix-based allow rule.

A nonzero job token/USD budget, inherited team budget, or prior token ledger
refuses request-limited execution. No budget is silently zeroed or changed. The
owner must explicitly choose the appropriate policy for the project. Laila's
model/account is not changed by this setting; sharing keys does not multiply
upstream quota.

## Before and after each submission

1. Validate policy, model, request cap (1..500), output cap, allowlist and current
   job/run ownership. Reuse existing bounded catalog evidence if explicit routes
   are configured; alternate gateway routes refuse.
2. Validate the complete bounded text/function request and preserve history.
3. Refuse if the persisted request count is exhausted. Save the incremented count,
   exact request identity, requested output cap and unknown-outcome intent before
   any generation submission. Input count is `null`, never invented zero.
4. Submit through the host broker. The worker/container receives only its own
   ephemeral local broker token, never the real gateway key.
5. Validate reported usage and structured response. Record actual input/output;
   cost is `null` because no verified price ceiling is enforced. Output above the
   requested cap is retained as an overrun and blocks further continuation.
6. Gate returned native calls through the existing human receipt/Guardian and
   read-only reviewer rules before delivering them to the engine. No returned
   tool call authorizes itself.

Missing usage, network/HTTP/decoding failures and cancellation retain the unknown
request intent and consumed submission count. No automatic retry or fallback.
After restart an explicit continuation with an unresolved submission is refused
for inspection. This increment does not add a new automatic request-outcome
resolver. Changed request/output policy also blocks continuation. Settled native
history and request counts carry through the existing explicit retry path.

The provider can violate `max_tokens`; Orbit can detect and stop after receiving
that overrun, not retroactively prevent remote generation. An output cap and
request count are not a hard cost cap. Request-only route context capacity is
configured metadata, not an exact counted-input guarantee.

## Reuse and duplication prevention

| ZCode pattern | Orbit implementation/action | Current boundary |
| --- | --- | --- |
| Main agent delegates children | Existing structured projects/workers/NeuralOps | No second scheduler/ACP framework added |
| Independent native sessions | Existing per-job contained CLI and private-session bindings | Live multi-worker/provider acceptance still required |
| Shared configured model credentials | Existing protected crew defaults plus worker-specific keys/models | Shared provider quota; no copied native auth files |
| Asynchronous task identity/status | Existing durable jobs/run ownership and progress | Job status is not verified deliverable quality |
| Parallel children | Existing separate-worker queue and worktrees | Same-worker jobs serialize; no broad shared-directory writes |
| Typed handoffs | Existing NeuralOps acts/messages and accepted artifact handoffs | ACK is not approval/ownership transfer |
| Reported tokens after native inference | New explicit gateway request-mode receipt | Exact token/USD limits unavailable in this mode |
| Exact budgets where supported | Existing count/reservation/team accounting | Unsupported counters cannot unlock budgeted execution |
| Child tool permissions | Existing broker receipts/Guardian/read-only reviewer policy | Live native approval acceptance remains separate |
| Interrupted continuation | Existing protected history/checkpoints/retry lineage | Unknown gateway submissions refuse replay |
| Native working state | Existing engine/schema-aware private-state recovery | Arbitrary plugins/private history conversion not generalized |
| Git worktrees/review | Existing revision-bound worktrees/candidate review/tests/human acceptance | Agent turn completion is not QA PASS |
| Temporary runtime cleanup | Existing owned Docker cleanup and storage admission | Images/build cache not automatically pruned |
| Long-running observation | Existing crew health/latency/storage observatories | Actual provider speed/production growth not inferred |
| Native provider discovery | Existing registry/router and explicit gateway catalog | Metadata does not prove model/tool quality or free billing |
| Desktop/server channel adaptation | Existing Electron/MCP control plane | Whole ZCode transport/platform parity not claimed |

## Owner Windows acceptance

After rebuilding/installing the updated draft:

1. Alex: engine `OpenCode`, provider `opencode`, model `space-bunny-free`, own
   masked gateway key, blank custom Base URL. Save engine.
2. Settings: explicitly choose OpenCode gateway execution → Request-limited;
   bounded worker requests/output. Job/team token/USD budgets must not be active
   for this mode. Do not change an existing team's approved budget to bypass it.
3. Verify the immutable runtime image/CLI remains available using existing checks.
4. Tiny real task, then website/candidate review/tests. Local fixture success is
   not authenticated live gateway, provider limits, billing or Windows proof.

No free/paid upstream call was made during development. The gateway's public
advertised pricing is not a durable free-price guarantee. The installed CLI,
current endpoint and model response compatibility require owner acceptance.


Pinned native compatibility follow-up: inspected anomalyco/opencode v1.18.35 session/prompt.ts ensureTitle, agent/agent.ts (disable removes the agent) and config/config.ts (compaction flags). OpenCode forks a tools-free title generation request, which could collide with the broker's single protected task transcript/parallel request gate. Shared pure mediation policy now disables native title generation and automatic compaction/pruning for host-mediated OpenCode configs, including the isolated runner. No title request is silently uncharged, no transcript dropping or extra upstream side session is accepted. Original task/session/workspace, provider/key/model/permissions remain unchanged. Source and config tests are not actual pinned CLI proof; owner native acceptance remains necessary.


Standalone Docker-helper fix: source inspection found six relative managed-write imports in native-container-runner.js, although Docker mounts only /orbit-runtime.js and the approved image contains no /managed-write.js. These would fail runtime writes; the same missing dependency could make filesystem-denial probes misleading. Replaced with shared writeRuntimeFile using Node fs inside the existing kernel-bounded tmpfs, while HOST admission/managed checkpoint publication remains unchanged. Added a real child Node process loading the helper from an otherwise empty temporary directory, writing/reading its config and checking no relative module dependency remains. This is standalone-module/process proof, not actual Docker/native CLI proof.

First broad run764total/760pass/1fail/3existing Hermes skips: unchanged sysmon timer test reported samples:2. Actual Electron UI25/25 passed with zero page errors; screenshot inspected separately. The failure is retained, not called a pass or fixed by changing unrelated timing assertions. Final native follow-ups and a sequential full rerun are required after the new standalone/title hardening.

Request-only gateway is additionally restricted at worker startup to the actual OpenCode engine; unverified Hermes/built-in gateway execution refuses before broker/model submission. The generic broker primitive's fixtures do not imply other native-engine compatibility. Actual worker engine mismatch regression added; unchanged exact-count engines remain supported.

## Original ACP adoption follow-up

User authorized adopting ZCode's full useful ACP execution idea with original Orbit code. The contained OpenCode transport now offers an explicit ACP preview: protocol negotiation, new/load native sessions, fixed broker model, streaming updates, cancellation and original-ID checkpointing. Existing job/NeuralOps/broker/Guardian/review systems are reused. No external source files, framework, dependency or second scheduler introduced. See `docs/acp-transport.md` for the implementation map, unsupported protocol extensions and actual Windows acceptance command. This supersedes the earlier statement that ACP transport is entirely pending; it does not claim full ZCode parity or real native ACP PASS.
