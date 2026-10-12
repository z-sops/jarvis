# Orbit ACP transport

## Adoption decision

Orbit adopts the useful Agent Client Protocol execution pattern with an original Node implementation. No ZCode file, Rust/Tauri framework, SDK dependency, second scheduler or communication database is imported.

The existing Home/job/project records remain authoritative. ACP is the conversation/control transport between the existing contained OpenCode worker and Orbit's mounted runtime helper. NeuralOps remains the authority for managed tools, delegation, identity and remote handoffs. The host model broker still owns real credentials, durable request intents, accounting and model policy. MCP still uses the current actor/run-scoped Orbit gateway.

| Reference pattern | Orbit implementation |
| --- | --- |
| Initialize/capability negotiation | Bounded newline JSON-RPC v1 client, protocol compatibility required |
| New native conversation | `session/new` with fixed `/workspace`, original native ID acknowledged before prompting |
| Existing native conversation | Capability-gated `session/load`, exact original ID, no fresh-session fallback |
| Worker model selection | Fixed custom broker model and pinned OpenCode `session/set_model`; other providers disabled |
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

This is separate from **OpenCode gateway execution**. ACP does not add tokens, multiply account quotas, make billing free or remove request/token/USD controls. Gemini/OpenAI/Anthropic exact-count routes retain existing accounting. The explicitly configured OpenCode Space Bunny request-only route retains its existing no-token/USD-budget limitation and unknown cost. No provider call or key authentication was made during development.

Transport is included in hash-verified checkpoint metadata. Legacy checkpoints imply `run`. A changed transport refuses before workspace restoration and container creation. To evaluate ACP, use a fresh reviewed job; do not reinterpret an older run checkpoint as ACP history. Changing provider/model/image also retains existing recovery binding checks.

## Security boundary

The ACP client advertises **no host filesystem or terminal capability**. Unsupported peer requests return method-not-found. ACP permission requests are cancelled and fail the turn; they cannot synthesize human consent or resurrect old grants. Existing broker permission receipts, Guardian and MCP permission enforcement remain in place. Arbitrary native shell operations remain denied by the existing OpenCode configuration.

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
