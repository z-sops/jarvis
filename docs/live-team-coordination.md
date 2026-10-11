# Live discussion and NeuralOps communication

This increment extends existing project cards, jobs, reservations, gateway and queues. It introduces no second scheduler, mailbox database or copied reference implementation. Full Windows/live/project-building acceptance remains in the owner's deferred end-to-end phase.

| Capability | Implemented scope | Remaining acceptance / limitation |
| --- | --- | --- |
| External discussion | Laila previews a scoped API payload, then requests fresh human approval for one turn; immutable model, prices, token/USD and 1–6 turn limits; persisted conversation and unknown reservations | Offline Responses path verified. Real provider calls/authentication/billing deferred. ChatGPT means OpenAI API, Claude means Anthropic API; consumer subscriptions/browser sessions are not used |
| Additional providers | Fixed official Kimi international, DeepSeek and Qwen Singapore compatible text/usage adapters; authenticated catalog discovery; explicit counter quality | No verified exact pre-count adapter for these three. Strict-budget generation remains blocked. Other regions/workspace-specific Qwen URLs and cached billing discounts are not assumed |
| NeuralOps communication | Questions, answers, receiver ACKs and handoff offers; job-owned stable act IDs, durable pre-send intent, exact original-act reconciliation and explicit recovery | Requires configured mapped identities, permitted tools and the companion NeuralOps ACK fix. Existing fixed local NeuralOps gateway is retained; remote clients/HTTP authentication and deployment not tested |
| Nested leaders | Root → up to ten existing sub-leaders, maximum four sub-leader levels, one direct owner per step, existing queues/dependencies/skills/Guardian/budgets | Finite human-approved root grant. No automatic hiring, second scheduler, acceptance authority or cancellation of independently owned child effects |

## External discussion flow

1. `prepare_external_discussion` records an offline draft using the goal and at most five explicitly selected report excerpts/hashes. Review the content for secrets. Automatic redaction of arbitrary project text is not claimed.
2. `preview_live_discussion` takes the existing draft ID and explicit `options`: `model`, `message` (Laila's turn), `maxRounds`, `tokens`, `usd`, `output`. A nonzero token or USD budget is required; USD budgets require configured per-million token prices. Preview returns the exact payload and revision without network activity. Unsupported count quality is visible.
3. `send_live_discussion` requires the same options and revision and a fresh non-session human permission. It counts input through the verified provider adapter, persists an unknown reservation and request fingerprint before generation, then settles actual usage and saves inert text. Existing aggregate project budgets also include discussion reservations/usage.
4. Laila may discuss the answer by preparing another explicit turn under the same immutable policy. Each turn needs fresh approval. Replies cannot resolve conflicts, invoke tools, grant permission, accept tasks or create workers. No provider tool is exposed.
5. Stop aborts the pending request. A crash, missing usage, lost reply or persistence failure after submission preserves uncertainty/charges and blocks automatic replay. Inspect the provider before a separate conversation; this increment does not refund uncertain charges or silently reset budgets.

Protected existing routing credentials are used in the main process and excluded from the preview, conversation and receipts. The fixed API hosts reject redirects. Responses are bounded to 1 MiB, reply text to 32,000 characters, output to 8,192 tokens and protected context to 128 KiB. The owner must configure credentials/models/prices; no paid calls were made during development. A catalog listing is not proof of generation availability or model quality.

Kimi documentation names its counter `estimate-token-count`; DeepSeek explicitly describes its downloadable tokenizer as an estimate. Neither establishes an exact reservation bound. Qwen has no verified pre-count endpoint in this increment. These providers therefore remain **partially supported**, not completed strict-budget engines. References: [Kimi API usage](https://www.kimi.com/en/help/kimi-api/api-balance-and-usage), [DeepSeek token usage](https://api-docs.deepseek.com/quick_start/token_usage/), [Alibaba regions](https://www.alibabacloud.com/help/en/model-studio/regions).

## NeuralOps delivery semantics

`send_remote_message` uses the current existing managed task binding and an exact mapped receiver. Questions are data; handoffs are remote ownership OFFERS, accepted separately through NeuralOps. A ledger receipt is not a receiver acknowledgement or human artifact acceptance.

`remote_agent_inbox` polls the authenticated identity. `answer_remote_question` accepts only an open question in that inbox. `ack_remote_message` first verifies the original question/handoff addresses this exact receiver. `recover_remote_message` reads the exact original act before an explicitly requested resend. Only the precise server `not_found: Act <id> not found` response permits retransmission using the SAME act ID; denied, malformed, truncated or unavailable lookups refuse. Startup does not replay.

A retry carries existing delivery intents through the existing verified same-owner retry linkage. Prior keys cannot silently become new acts. Changed actor/connector/endpoint, stopped runs and persistence failure refuse before further sends. Each call retains the existing gateway tool allowlist, Hub permission and managed Guardian path. The adapter does not create administrative authority or an unrestricted remote URL.

### Required companion ACK fix

NeuralOps MCP previously used `actId` as both ACK target and envelope idempotency key; stripping the envelope key removed the required target. In NeuralOps draft PR #1, ACK retains `actId` as the target and uses optional `operationId` as the envelope ID. Other tools retain their existing `actId` retry contract. Addressed questions/proposals/handoffs reject ACKs from a sender or unrelated agent. This is an actual protocol correction in NeuralOps, not an Orbit alias hiding a broken server.

## Nested hierarchy

`plan_project` optionally includes `teamHierarchy: [{leader, parent, steps}]` with existing IDs. The root owns unassigned steps; each sub-leader owns only its declared direct steps. Duplicate leaders/step ownership, unknown parents/steps, cycles, depth overflow and leader/leaf overlap reject. The root approval preview includes the complete hierarchy and pinned worker configuration.

`delegate_subteam` can dispatch only a direct child. `get_team_plan` returns the active leader's direct steps/children. Every delegation rechecks the current job/run, immutable root scope and active ancestor runs. A parent stop or worker/configuration drift revokes further delegation, but does not undo already executed effects. Sub-leader linkage is persisted before enqueue; a previously linked child cannot be automatically recreated. Generic coordinator retry still needs a fresh human root approval.
