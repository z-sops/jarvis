# User verification checklist

Use the existing draft PR for review. Do not overwrite an unrelated Windows checkout or merge/deploy automatically. Never paste real credentials into chat or logs.

1. **Windows credential migration:** on a backed-up disposable home with synthetic keys, verify settings, connector and worker files no longer contain those values after startup; restart and confirm retrieval. Test unavailable key-store handling without deleting the old files. Report pass/fail and sanitized error only.
2. **Windows lifecycle:** verify installer, hidden startup/tray, workspace paths with spaces, cancel/stop, application restart and interrupted-job state. No automatic replay of uncertain effects.
3. **Real engines:** select installed Hermes/OpenCode versions and intended model/provider. First use a no-effect fixture task; then a bounded own-workspace artifact task. Confirm actor/model identity, permission prompts, cancellation and output evidence. Any paid usage needs an explicit budget.
4. **NeuralOps:** provide service availability/account selection through the app; verify identity, managed gates, handoff and receipt sync without production mutations. Real secrets stay local.
5. **Browser regression:** supply a complete supported Chromium runtime or run the standalone Playwright suite in a suitable environment. Report the exact suite result; historical success is not a current pass.
6. **Voice/comms:** test actual microphone and desired channels separately. Notifications to other people require explicit recipient/action authorization.

Engineering work still open is listed separately in gap-register.md. Passing this checklist alone does not complete independent revision-bound QA, universal engine enforcement or full Laila orchestration.
