# Orbit / ZCode execution forensic audit

Date: 2026-10-14. This is a source comparison and offline boundary audit, not a successful live-provider repair or beta acceptance.

## Verdict

Orbit currently uses OpenCode as a contained execution engine behind Orbit's own model broker. ZCode uses OpenCode as the native provider/session owner through ACP. These are different execution architectures, even when both UI cards say `OpenCode / Space Bunny Free`. Adopting ACP alone did not make the provider request, credential handling, tool availability or approval behavior equivalent.

The owner changed the key and ran a fresh text-only job. The supplied screenshot still records HTTP 403 with `free_tier_native_client_required`. That observation does not establish an invalid key, exhausted Gemini quota or a broken NeuralOps token. It also does not isolate one exact server-side predicate.

Two independent functional gaps were reproduced offline: worker-specific model selection removes Auto routing alternatives before the broker sees them; ACP rejects a namespaced OpenRouter model ID accepted by the provider registry. Neither explains the specific plain-ID Space Bunny 403 by itself.

## Revisions and evidence coverage

- Orbit audited head: `85ef2b24fa53c812cd4904a62053b5d3ec4b9df6` on `codex/strengthen-neuralops-identities`.
- ZCode audited head: `fd313ae3d32db243e61af26fc0be4501584d4690` on `main`; current GitHub branch matched the existing snapshot.
- Orbit: 336 Git blobs inventoried, 333 local bytes matched Git SHA-1 exactly, zero mismatches. Three documentation PNGs were absent locally.
- ZCode: 3,129 Git blobs inventoried, 1,950 available files matched exactly, zero mismatches. The 1,179 omissions consist mainly of generated `out/`, media/binaries, lockfiles, parser snapshots and build metadata. These omitted files were not inspected or executed. Hash coverage is not a claim of semantic review of every source line.
- Semantic audit followed the relevant settings/provider, ACP launch/session/permission, model selector, delegation, replay/recovery, database and packaging boundaries. Unrelated visual components were inventoried, not exhaustively tested.
- ZCode source tests, Rust build and the owner's installed ZCode binary were not executed here. Its registry recommends OpenCode 1.18.31; the owner's installed ZCode CLI version remains unknown. Orbit's private adapter pins 1.18.35. They must not be assumed to be the same binary.
- Existing owner ZCode screenshot shows Space Bunny responses; it supplies no wire capture, effective configuration, binary hash or credential-equivalence evidence. No private configuration or secret was requested.

## Execution path comparison

| Boundary | ZCode audited behavior | Orbit audited behavior | Consequence |
| --- | --- | --- | --- |
| Launch | Rust launches native `opencode acp` | Docker helper launches `opencode run` by default; ACP is opt-in | Current default is not ACP parity |
| Native provider | User's native provider/configuration drives OpenCode | Helper enables only `custom`, using `@ai-sdk/openai-compatible` and a loopback alias | Native provider-specific behavior is replaced |
| Credentials | Provider ID maps to native `auth.json`; connector scrubs config `options.apiKey` | Real key stays on host; engine receives only ephemeral broker token | Intentional credential isolation; not interchangeable |
| Provider destination | Selected native provider adapter resolves endpoint/protocol | Fixed registry and host `native-provider.prepare` rebuild request | Native protocol behavior is not inherited merely by launching OpenCode |
| Client metadata | Actual OpenCode native request builder adds session/request/client metadata | Container relay carries method/path/body only; host rebuilds headers | Authentic metadata is dropped at multiple boundaries |
| Streaming | ACP delivers incremental native session updates | Host gateway adapter changes upstream request to `stream:false`, then can emit downstream SSE | Downstream streaming does not prove upstream first-token streaming |
| Tools | Native configuration and permissions determine the offered tools | Blanket deny, explicit read/glob/grep/edit allow, bash deny, owning Orbit MCP allow | Toolset differs; relevant to upstream free-tier reports |
| Human permissions | Native ACP permission cards enter queue; selected option resolves exact request | ACP permission request is cancelled and connection fails; host broker separately approves returned tool calls | Missing native approval bridge, not full ZCode approval parity |
| Models | ACP model/config option controls update native session; catalog mirrors models.dev | Saved worker selection; run model alias pinned; stopped conversion is explicit | Manual picker parity is partial; live session switching is different |
| Auto routes | Inspected model selectors/delegation code does not establish universal provider failover | Initial catalog routing plus first pre-generation count-HTTP fallback only | Do not advertise uninterrupted universal auto switching |
| Per-worker Auto | Native child receives selected preferences | Worker override filters route list to exact worker provider/model | Alternative routes disappear before Auto logic can use them |
| Resume | Native session/load capability; classified failures, replay drain and selected new-session/history-link paths | Original private session restored with image/provider/transport fences; unknown effects block retry | Similar replay principles, different recovery authority |
| Delegation | MCP companion, parent conversation/tool/call linkage, child ACP connections, bounded depth | Existing NeuralOps/project/job ownership, finite leaders, approved scope and remote durable act receipts | Retain Orbit ownership; no need for a second scheduler |
| Storage | App SQLite plus native stores/transcripts; WAL pragmas on app DB | Durable Home job/event records plus broker history and encrypted native/workspace checkpoints | WAL is concurrency/recovery machinery, not a storage-growth solution |
| Plugins | Native plugin/config handling and launch-time resources | Restricted tmpfs runtime and schema-aware private-state sanitization | Arbitrary plugin parity is absent by design; cannot blindly copy stores |
| Completion | Native turn/session events and work-task state | Native text/end_turn is candidate; QA/review/human acceptance separate | Preserve Orbit acceptance gates |

## Findings

### F01 — P0: native provider compatibility is not equivalent (confirmed architecture; exact 403 cause unisolated)

Orbit evidence: `lib/workers.js` broker/container startup, `lib/native-container-runner.js` `run/createRelay`, `lib/native-containment.js` broker frame relay, `lib/native-broker.js` `upstream`, `lib/native-provider.js` `prepare/decode`, `lib/provider-registry.js`.

ZCode evidence: `src-tauri/src/acp/registry.rs` OpenCode distribution; `src-tauri/src/acp/connection.rs` `build_agent/spawn_agent_connection`; `src/lib/opencode-connect.ts` `applyApiKeyConnect`; `src-tauri/src/commands/acp.rs` `persist_opencode_native_config`.

The offline probe sent synthetic actual-looking client metadata into the real Orbit broker. Its captured upstream headers contained only `Authorization` and `Content-Type`; input `stream:true` became `stream:false`. The container relay drops headers earlier as well. Changing only the API key cannot repair these differences.

Pinned upstream OpenCode 1.18.35 `packages/opencode/src/session/llm/request.ts` branches on `providerID.startsWith("opencode")` to add native metadata. Orbit's `custom` provider does not take that branch. This is direct source evidence, not a recommendation to fabricate headers.

Upstream reports [#50627](https://github.com/anomalyco/opencode/issues/50627), [#51315](https://github.com/anomalyco/opencode/issues/51315) and [#52907](https://github.com/anomalyco/opencode/issues/52907) describe the same error with restricted tools and, separately, native-client failures. Their reports support multiple candidate causes. They are not an independent reproduction against the owner's account. Forwarding metadata alone is not a proven repair.

### F02 — P1: worker override truncates Auto route candidates (reproduced)

`lib/workers.js` passes a filtered `workerRoutes` list when `cfgOverride.workerModel` is present. The filter requires exact provider AND model before `native-broker.start` sees the configuration. With an explicit worker engine, the effective default model can also populate this override.

Actual `createWorkers/dispatch` probe, stopped before provider submission:

| Configuration | Routes reaching real broker call |
| --- | --- |
| Crew default, Auto, primary + backup | primary + backup |
| Worker override, Auto, primary + backup | primary only |

The broker's Auto logic cannot recover a route already removed by its caller. Separate per-worker selection policy from routing scope; preserve configured authorized alternatives only when Auto is explicitly selected. Pinned behavior must remain exact. This is independent of the free-tier refusal.

### F03 — P1: ACP model-ID validation disagrees with picker/registry (reproduced)

`provider-registry.validModel` accepts namespaced IDs such as `nvidia/nemotron-fixture:free`. `AcpClient.open` in `native-container-runner.js` accepts only `custom/` plus letters/digits/dot/underscore/hyphen. The same saved model becomes `custom/nvidia/nemotron-fixture:free` and fails before initialize.

Actual `AcpClient.open` probe: plain model sent initialize/session-new/set-model; namespaced model returned `ACP session scope invalid` with zero methods sent. This is an ACP-only gap; it does not explain a run-mode plain Space Bunny request reaching HTTP 403.

### F04 — P1: advertised model choice is broader than implemented upstream protocol support (confirmed scope gap)

Picker returns bounded catalog IDs and correctly disclaims inference access/protocol proof. For OpenCode/OpenRouter, the current host adapter always builds Chat Completions. Native ZCode delegates model-specific protocol/SDK behavior to OpenCode. Orbit's custom single-protocol bridge does not inherit Responses/Anthropic/reasoning/media compatibility. An available model ID is not execution compatibility evidence.

### F05 — P1: native ACP approvals are not bridged (confirmed capability gap)

ZCode `admit_permission/resolve_permission` queues exact native requests. Orbit `AcpClient.frame` answers cancelled and fails. Orbit's host approval of a returned model tool call is a different event and cannot be treated as the native permission response. This prevents full native tool availability under an ask policy. Never switch everything to allow, synthesize approvals, or copy native permission grants on restore.

### F06 — P1: auto-switching product claim exceeds implemented guarantee (confirmed limitation)

Orbit's broker fallback requires Auto, selected configured route, zero prior requests, no prefix/pending state, and a token-count HTTP refusal before generation. Request-limited OpenCode has no count endpoint and therefore does not enter that fallback loop. A 403 at model_request does not auto-switch. ZCode's inspected selector, session config and delegation code establishes user-driven selection and recovery paths, not a verified universal OpenCode-provider failover promise. No inference from a variable named `fallback` is sufficient.

### F07 — P1: generic authentication label obscures policy refusal (confirmed presentation problem)

Orbit classifies all 401/403 as `authentication_refused`, then adds the useful `free_tier_native_client_required` reason. The latter is the actionable evidence. Diagnostics should distinguish credential refusal, provider policy, unavailable model and transport uncertainty without retaining raw response bodies. This improves explanation; it is not an execution fix.

### F08 — intentional safety difference: unknown request handling is conservative

Orbit persists request intent/count before generation and retains unknown outcomes after HTTP refusal. This can force human review before continuation even when tools never ran. It protects accounting and replay safety; it is not evidence that the provider actually billed or executed anything. ZCode's classified session-load/new-session fallback is not a substitute for Orbit's durable budget/effect reconciliation. Preserve it while making recovery UX clearer.

### F09 — intentional safety difference: session continuity is not universal portability

Original private session, visible broker transcript, native TODO data, workspace revision, grants and plugin databases are distinct. Orbit has explicit schema/version/image/provider/transport binding and sanitization. ZCode's history links and replay drains improve conversation continuity but do not prove cross-provider private-database conversion. Do not replay historical approvals, queued actions or unknown tools to improve visual continuity.

### F10 — acceptance gap: detection/fixtures do not establish live compatibility

CLI/isolation checks prove version and Docker boundary; local deterministic provider fixtures prove plumbing and state transitions. Neither exercises hosted free-tier predicates. Existing tests pass while the ACP namespaced-ID discrepancy and worker Auto route truncation are observable. New acceptance must test those cross-layer combinations rather than add isolated helper tests only.

## Offline probes and tests

Machine-readable observations: [orbit-runtime-audit-results.json](orbit-runtime-audit-results.json).

Five observations used real Orbit functions with synthetic credentials/state: crew Auto routes; worker override Auto routes; broker request rebuild; plain ACP ID; namespaced ACP ID. Model generation was stubbed. There were no live provider calls, Docker launches, production profile edits or credential reads. The probe asserts the observed audited behavior; it is not a claim the missing capability passes acceptance.

Focused existing regression run: 138 tests passed, zero failed, zero skipped, 4.514 seconds. Files: native-broker, native-containment, opencode, model-router, native-private-state, agent-communication, nested-teams. No new full-suite, Rust, native-provider or Windows E2E PASS is claimed.

## Integrated repair sequence

1. **Provider execution contract first.** Define a supported contained-native provider route, including protocol, authentic CLI metadata, selected model, allowed tool capabilities, auxiliary requests, usage and refusal semantics. Keep fixed egress destinations, host credential injection, request reservations and no automatic replay. Compare sanitized request shape to a genuine native OpenCode flow; never add fake tools or impersonation headers to trick free-tier checks.
2. **Native permission bridge with that contract.** Exact session/run/tool/action binding, fresh human/Guardian receipt, bounded waiting/cancel, duplicate/late response fencing, and replay drain. This must precede changing denied native tools to an ask policy. Persist no reusable grant.
3. **Model and routing coherence in the same acceptance batch.** Registry/picker/ACP agree on namespaced IDs; worker Auto preserves authorized alternatives; Pinned remains exact; each adapter has explicit protocol support. Mid-generation uncertain failure never becomes a transparent replay. Separate initial routing, safe pre-submission fallback and user-reviewed continuation in UI/product claims.
4. **Recovery and full job acceptance.** Same-session restart, workspace/private revision match, no credential/grant/action reactivation, exact candidate reviewer handoff, build/tests and final human acceptance. Measure storage and latency during the same bounded workload.

Acceptance matrix must include crew default versus per-worker override; run versus ACP; simple versus namespaced model; Chat Completions versus other supported protocol; Pinned versus Auto; no-tool response versus allowed tool versus denied action; initial refusal versus uncertain submission; fresh versus restored session; stopped/cancelled/replayed permission; free-tier versus another explicitly selected provider. Use local fixtures first and one bounded owner-run live check per supported route afterward.

No runtime change is included in this audit. Do not rebuild or reinstall merely for this report. The current Space Bunny compatibility failure remains unresolved, with a broader repair contract and two reproduced integration defects instead of another key-rotation or isolated patch loop.

## Implementation follow-up — 2026-10-14

The audit above describes its pinned baseline, not the implementation added afterward. The authorized combined batch addresses F02 (per-worker Auto route scope), F03 (namespaced ACP IDs), F05 (bounded fresh native approval bridge), F07 (provider-policy error category), and part of F01 (actual native OpenCode provider identity, generated metadata preservation and upstream streaming). All native model calls still use Orbit's fixed host broker and accounting; this is not a wholesale copy or native direct-network path. F04 universal protocols, F06 uninterrupted failover and live free-tier acceptance remain unproven/limited. Old saved execution contracts are not silently migrated. See the updated ACP transport documentation and project-update.md for tests and owner acceptance instructions.
