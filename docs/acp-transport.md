# Orbit ACP transport

## Adoption decision

Orbit adopts the useful Agent Client Protocol execution pattern with an original Node implementation. No ZCode file, Rust/Tauri framework, SDK dependency, second scheduler or communication database is imported.

The existing Home/job/project records remain authoritative. ACP is the conversation/control transport between the existing contained OpenCode worker and Orbit's mounted runtime helper. NeuralOps remains the authority for managed tools, delegation, identity and remote handoffs. The host model broker still owns real credentials, durable request intents, accounting and model policy. MCP still uses the current actor/run-scoped Orbit gateway.

| Reference pattern | Orbit implementation |
| --- | --- |
| Initialize/capability negotiation | Bounded newline JSON-RPC v1 client, protocol compatibility required |
| New native conversation | `session/new` with fixed `/workspace`, original native ID acknowledged before prompting |
| Existing native conversation | Capability-gated `session/load`, exact original ID, no fresh-session fallback |
| Worker model selection | One mediated provider/model; fresh OpenCode-provider ACP uses native provider identity, other routes retain custom alias; no automatic model fallback |
| Streaming response | ACP text chunks append correctly to the existing OpenCode collector and UI callbacks |
| Tool progress | Native tool IDs/statuses project into existing job progress; raw inputs/outputs/names stay private |
| Native plan updates | Observational thinking status; cannot replace a Laila project card or authorize dispatch |
| Cancellation/deadline | Owning session cancel notification, bounded waits, existing whole-container stop/quarantine |
| Parent/child delegation | Existing project/job/team/NeuralOps tools and queue; no ACP-owned scheduler |
| Session persistence | Existing encrypted SQLite/workspace checkpoint, now captures acknowledged OpenCode ID |
| Restart replay | Historical ACP updates suppressed from fresh output/action reporting; existing uncertain-effect guards retained |
| Completion | `end_turn` yields a candidate; artifacts, independent review, host tests and human acceptance stay separate |

## Explicit configuration

Settings → **OpenCode transport**:

- **Existing JSON run** is the unchanged default for existing installations and checkpoints.
- **ACP sessions (preview)** selects `opencode acp` inside the same Docker container. Adapter is pinned to OpenCode **1.18.35**, whose source was independently inspected. Other versions refuse; no host or alternate-transport fallback.

This is separate from **OpenCode gateway execution**. ACP does not add tokens, multiply account quotas, make billing free or remove request/token/USD controls. Gemini/OpenAI/Anthropic exact-count routes retain existing accounting. The explicitly configured OpenCode/OpenRouter request-only route retains its existing no-token/USD-budget limitation and unknown cost. No provider call or key authentication was made during development.

Transport is included in hash-verified checkpoint metadata. Legacy checkpoints imply `run`. A changed transport refuses before workspace restoration and container creation. To evaluate ACP, use a fresh reviewed job; do not reinterpret an older run checkpoint as ACP history. Changing provider/model/image also retains existing recovery binding checks.

## Security boundary

The ACP client advertises **no host filesystem or terminal capability**. Unsupported peer requests return method-not-found. Fresh native permission requests use the existing human approval UI, acknowledged session and current actor/job/run. Only an original `allow_once` option and a fresh main-window receipt can return authorization, after durable argument-hash recording. Unknown kinds, external/private paths, reviewer writes/shell, Guardian hard denial, duplicate IDs, cancelled/expired runs and failed persistence refuse. Historical replay never prompts or restores a grant. Fresh OpenCode-provider ACP enables native bash with `ask`, not `allow`; other modes retain bash denial. Execution remains inside the existing no-network Docker container. Broker tool-result approvals remain a separate gate; a native action can require a second fresh approval.

MCP is configured once in the isolated OpenCode config, not registered a second time through `session/new`. The ACP session therefore sends an empty `mcpServers` list, matching the existing configured owning-actor gateway. Native config, credentials, queues and plugin code are not recovered from arbitrary homes.

ACP wire bodies are not written into logs. Only the native assistant's intended text and fixed tool/progress projections reach the existing report collector. Internal thinking, tool arguments/results/names and replayed history are not forwarded. Unsupported/malformed messages, foreign session updates, duplicate response IDs, oversized streams and unsupported protocol versions fail closed. Text from a late update after the prompt response does not become a new reply. A subsequent malformed frame before settlement prevents successful completion.

Control requests have at most a 60-second response window; prompts use the existing bounded job deadline. At most eight outstanding requests, 1MiB outgoing frame, 2MiB receive buffer, 16MiB stream and 8,192 events. Existing host containment bounds also apply. There is no automatic resubmission, model fallback or restart on connection failure. Best-effort ACP cancel is followed by confirmed container stop; notification delivery alone is not termination proof.

After a completed ACP turn, the native child is stopped with a bounded shutdown wait before the final snapshot. The host confirms the whole container stopped before applying a candidate. Database capture uses SQLite online backup and the acknowledged ACP session ID; a newer unrelated session cannot substitute for it.

## Offline Windows acceptance

Use the existing separate verification checkout and installed immutable image. No image pull, dependency installation, live provider or production profile is needed:

```powershell
node "G:\jarvis-containment-check\scripts\native-task-check.js" `
  "sha256:018544b25065b555d1a913373bc8164eebe0280794ec8ae92fbfed6acab4e6d8" `
  --private-continuity --acp
```

The script reports the selected OpenCode transport explicitly. Hermes remains on its existing transport. The disposable deterministic fixture must prove actual contained ACP generation, existing owning-actor MCP tool execution, checkpoint publication, stopped container, original private session restore and prior native tool history reaching the model. A unit-test subprocess is not this actual CLI proof.

## Current limits

ACP v1 lifecycle and pinned OpenCode model extension are implemented. Actual Windows Docker/OpenCode ACP compatibility and full website acceptance remain unverified. Existing native `run` PASS results do not automatically pass this new transport. Physical outage, real provider/billing, production keystore lifecycle, native TODO/plugin behavior and model review quality retain their prior evidence boundaries.

This is not universal ACP implementation or full ZCode feature parity. Rich image/audio prompts, native interactive terminal/file services, live steering, fork/list/mode selection, arbitrary agent adapters and warm background process pooling are not exposed. Session IDs and history stay in the existing protected checkpoint; there is no second transcript database. These additions require concrete task demand and verified security adapters before enabling them.

## Independently inspected sources

- ZCode ACP connection, manager, registry and subagent broker/spawner at `fd313ae3d32db243e61af26fc0be4501584d4690`; prior folder inventory and audit recorded in `docs/zcode-patterns.md` / `project-update.md`.
- [ACP initialization](https://agentclientprotocol.com/protocol/v1/initialization), [session setup](https://agentclientprotocol.com/protocol/v1/session-setup), [prompt turns](https://agentclientprotocol.com/protocol/v1/prompt-turn), [tool calls and permission outcomes](https://agentclientprotocol.com/protocol/v1/tool-calls).
- [Pinned OpenCode ACP service](https://github.com/anomalyco/opencode/blob/53d1eabb61e21162157817bf677da0a4ad3332e3/packages/opencode/src/acp/service.ts): new/load sessions, model selection, original conversation replay, stop reasons and configured MCP registration. Agent/session/event wrappers also inspected at this same revision. Reference study only; no source copied.


## Owner Windows acceptance result (2026-10-12)

On draft head8f97cf5 and installed image018544b25065..., owner ran the documented --private-continuity --acp command on Docker Linux29.5.3. OpenCode explicitly reported acp and all10task/MCP/checkpoint/private-history checks passed; Hermes unchanged transport passed10/10. OpenCode resumed6messages including prior marker/tool history; no duplicate fixture call. Single fresh-container recovery7.04s (Hermes13.06s); total fixture15.54s/30.83s includes original execution AND restart, not one-job/project latency. This is owner-supplied real native offline evidence, not an assistant rerun or real provider/power-loss/plugin/production approval/billing proof. Earlier unverified-native-ACP statements are superseded only for this pinned fixture. Installed app/live website acceptance remains pending.

## Combined native-provider repair (2026-10-14)

Fresh jobs selecting OpenCode engine, OpenCode provider and ACP transport now use the actual native `opencode` provider identity with the same loopback endpoint and ephemeral broker token. Real upstream credentials remain on the host. The original CLI-generated, bounded session/request/client/version metadata is forwarded through both relay boundaries only to the fixed generation endpoint. Nothing fabricates a client header, tool, approval or provider identity for a non-OpenCode worker. MCP/actor credentials are not forwarded as model metadata.

The request-limited broker records this native wire contract in protected execution policy. Existing saved journals without it keep the previous contract; retry does not silently migrate a native session. Reviewed conversion to another provider retires the native contract only in the fresh target and preserves the protected source archive. Existing image/model/provider/transport/private-state and uncertain-outcome guards remain. Use a fresh job to evaluate the new contract.

Native requests preserve upstream streaming and request usage metadata. A bounded Chat Completions SSE assembler requires complete finish, usage, candidate and tool-ID evidence; truncated, opaque/unsupported reasoning, malformed, oversized and late data refuse without refund/replay. Upstream streaming is currently buffered before downstream delivery so tool approvals, usage settlement and protected response publication precede execution. This is not first-token UI streaming or universal protocol compatibility.

ACP accepts the same bounded namespaced model characters as the host registry, including OpenRouter IDs. Per-worker Auto no longer discards authorized backup routes before the broker; Pinned still filters exact selection. These changes do not add mid-generation automatic failover. Free-tier policy refusal has its own `provider_policy_refused` category and retains original unknown accounting. Actual hosted-provider acceptance of this native request/permission configuration still requires the owner Windows test. Earlier private-continuity fixture PASS does not prove this new native provider route.


### Fixed rejection diagnostics
Native failure records add `rejectCode`, bounded `rejectDetail`, `validationPhase` and `submissionPhase`. The request acceptance policy is unchanged. Unsupported content arrays still reject with `non_string_content`; arbitrary extra field names become `unknown_field`. Model mismatch records only lengths and equality flags. These distinguish a failed check without retaining payloads.

Submission phases come from broker control flow, not the activity meter. `before_submission` precedes generation reservation; `submission_reserved` includes a failed persistence attempt; `submitted_outcome_unknown` starts before upstream generation fetch; `response_received` means a successful upstream HTTP response was obtained, not that parsing/accounting/tools succeeded. Token-count requests stay before generation submission. Old diagnostics have no retroactive phase. Nothing here authorizes replay or clears prior uncertainty.

The Office error text exposes the rejection code and phase. Windows fresh native-provider acceptance remains pending: after rebuilding, run one fresh text-only job and inspect only fixed diagnostic fields. The implementation is a diagnosis aid, not a confirmed repair of the owner's payload mismatch hypothesis.


### Request-field diagnostic round 2
`unsupported_request_field` now names only a fixed set of standard candidate parameter names (store, reasoning_effort, prompt_cache_key, safety_identifier, service_tier, stop, seed, frequency_penalty, presence_penalty, logit_bias, logprobs, top_logprobs, response_format, modalities, audio, prediction, web_search_options, verbosity, top_k, thinking, reasoning). This vocabulary does not authorize any of those parameters. Every other name remains unknown_field.

The first rejected field additionally records valueType (type only), unknownCount (capped at20) and nameHash (12 lowercase hex characters from SHA-256 of the name). No values or arbitrary names are persisted. The hash is a diagnostic matching aid, not encryption or a secrecy guarantee for guessable names. The existing allowlist, HTTP400 message, budgets, approvals and submission phases are unchanged.


### Native reasoning-effort compatibility
Owner Windows job5086969a identified reasoning_effort/string as the sole unsupported top-level field; nativeClient request validation now permits only none/minimal/low/medium/high/xhigh. This is a scoped local enum, not a promise every model accepts each value. Only the existing nativeClient OpenCode-provider ACP contract enables it. Legacy journals, run transport and other providers still reject the field.

The validated field is forwarded in the actual rebuilt upstream body, never silently stripped. The protected pending intent records its validated effort and the upstream request SHA256 before submission; unknown outcomes retain those fields. Existing transcript digests and budgets are unchanged. Reported completion_tokens are counted once, including any provider-reported reasoning component; there is no exact pre-count or separate reasoning budget guarantee in request mode. Overages remain charged/recorded and block continuation. A provider400 stays provider_http_failure with its status and uncertain intent, without implicit retry or parameter stripping. Reasoning SSE delta support is unchanged and may still refuse unsupported response formats.

Reference inspected: https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create . General Chat Completions documentation is not Space Bunny acceptance proof. Windows text-only, scoped tool, coding and restart/resume acceptance remain owner tests.


### Message-field diagnostics and request/job distinction
Unsupported message fields now expose only fixed candidate names (reasoning_content, reasoning, reasoning_text, reasoning_details, reasoning_opaque, refusal, audio, function_call, annotations, cache_control, providerOptions, provider_options, prefix, partial), type, first-name hash, capped count, message index and allowlisted role. All remain rejected. Unknown arbitrary names and every content/argument/reasoning/tool-result value remain absent.

On rejection only, a bounded independent scan reuses the same validator rules to find top-level/message/content/tool/choice/limit violations. First rejection and HTTP400 text stay unchanged. At most10 sanitized findings and2000 checks are reported; findingsTruncated marks incomplete coverage. Lists are bounded, and diagnostics never execute/approve/restore anything.

before_submission describes the rejected request, not earlier requests in the job. Failure diagnostics add continuity requestCount, durably recorded settledResponses when known, and pendingToolOutcomes. The request count includes reserved/uncertain intents, not guaranteed provider submissions. Settlement comes from the saved continuity record, not unpersisted decoded data. Office and the commander report text explicitly preserve earlier uncertainty; Laila's prompt uses the same distinction but live paraphrase correctness is not universally proven. Existing pending-effect/retry/conversion controls remain unchanged.


### Scoped assistant reasoning-content normalization
Owner Windows job670f4c59 confirmed reasoning_content/string on assistant message index2 as the sole scanned violation, after one settled generation with one pending tool outcome. Only the existing nativeClient OpenCode-provider ACP path now removes assistant reasoning_content before validation/history merge/preparation. It accepts only strings up to16384 UTF8 bytes; invalid types or larger strings produce invalid_reasoning_content with type/length bucket only. Other roles, legacy and other-provider contracts remain rejected. No other message field is allowed/removed.

The broker does not forward or journal this CLI-added digest-unbound field. Normalization copies messages without mutating the caller, and canonical history comparisons remain unchanged. nativeRequestDiagnostics.strippedReasoning records the latest normalization count and maximum byte-length bucket (0,1-256,257-4096,>4096); failure diagnostics include the same safe metadata. This is no proof of tool execution. Existing response reasoning/opaque-stream support is unchanged; no new reasoning capture protocol was added.

A provider requiring reasoning round-trip may still reject the stripped request; HTTP failure stays visible and its uncertain intent/count remains protected. No automatic re-add, fallback/replay, old pending-outcome resolution or permission weakening. Fresh owner tool/file and subsequent coding/restart acceptance remain required.
# History conflict diagnostics

History rejections retain their original error text; the scoped compatibility rule below is the only equality change. Safe detail identifies prefix_mismatch, resume_diverged, resume_no_verified_prefix, unresolved_tool_actions or history_bound. Prefix comparisons report the first differing index and at most ten entries from the first ten protected messages, with fixed field names, known roles and content kinds/UTF-8 length buckets. Text, IDs, function names and arguments are never diagnostic values. After the owner confirmed null-versus-empty as the sole mismatch, native OpenCode-provider ACP comparison equates null/empty only for assistant messages with tool calls, on both protected and incoming sides. All other contracts, non-empty text, whitespace, roles and call fields remain strict. Raw journal messages are not rewritten.

nativeFailure reasoningScope=rejected_request describes the failing request. nativeRequestDiagnostics reasoningScope=last_saved_request describes the normalization present at the last durable broker save; it does not claim acceptance or successful submission. Existing scalar summaries remain available for compatibility. Old records have no retroactive scope.

