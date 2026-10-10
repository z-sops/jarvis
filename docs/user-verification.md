# User verification checklist

Use the existing draft PR for review. Do not overwrite an unrelated Windows checkout or merge/deploy automatically. Never paste real credentials into chat or logs.

1. **Windows credential migration:** on a backed-up disposable home with synthetic keys, verify settings, connector and worker files no longer contain those values after startup; restart and confirm retrieval. Test unavailable key-store handling without deleting the old files. Report pass/fail and sanitized error only.
2. **Windows lifecycle:** verify installer, hidden startup/tray, workspace paths with spaces, cancel/stop, application restart and interrupted-job state. No automatic replay of uncertain effects.
3. **Real engines:** select installed Hermes/OpenCode versions and intended model/provider. First use a no-effect fixture task; then a bounded own-workspace artifact task. Confirm actor/model identity, permission prompts, cancellation and output evidence. Any paid usage needs an explicit budget.
4. **NeuralOps:** provide service availability/account selection through the app; verify identity, managed gates, handoff and receipt sync without production mutations. Real secrets stay local.
5. **Browser regression:** supply a complete supported Chromium runtime or run the standalone Playwright suite in a suitable environment. Report the exact suite result; historical success is not a current pass.
6. **Voice/comms:** test actual microphone and desired channels separately. Notifications to other people require explicit recipient/action authorization.

Engineering work still open is listed separately in gap-register.md. Passing this checklist alone does not complete independent revision-bound QA, universal engine enforcement or full Laila orchestration.


For this planning/budget slice, use a disposable home: confirm dependency steps stay blocked until a reviewed artifact is accepted, and editing that artifact blocks them again. Set explicit verified model rates and a small approved budget before any live Gemini test. Confirm unknown charges survive a stopped retry. Supported Gemini/OpenAI/Anthropic text/function native jobs should use the broker; unverified providers/features must refuse. Do not disable policy to work around that refusal. OpenCode's current native adapter accepts 1.x only and denies native shell/outside-directory tools. Verify the actual Hermes approval UI independently; its generated configuration is not proof of enforcement.


Native-budget/continuity verification requires installed real engines and a working protected key store. In a disposable home, choose an explicitly approved budget and verified model rates. Check that a too-small reservation prevents generation, subsequent requests stop at the limit, and missing/unknown usage remains charged. Do not infer this from a CLI success report. Confirm the process uses the scoped loopback route, same model policy, fresh tool approval and no accidental native provider fallback.

Stop after a no-effect response, restart and explicitly retry; check prior goal/tool IDs/results are present and accounting persists. After a possibly executed tool, inspect its actual files/external effects before recording every pending outcome in Office. Confirm retry refuses unresolved effects or a changed provider/model/policy and never inherits approval grants. Use only disposable files; do not deliberately crash production work. Native private-session databases and OS containment remain separate engineering gaps even if these checks pass.
