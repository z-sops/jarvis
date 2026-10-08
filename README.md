# Bridge

An always-on AI first officer that lives in its own space-shuttle world.
It talks with you in real time, uses your computer (with permission), and runs a crew of agents. Every agent is a folder.

![Bridge](docs/bridge.png)

## Run it

```
npm install
npm start
```

Needs Node 20+. On first start the ship asks you to **commission** it:

1. **Callsign** – what the AI is called (Jarvis, Nova, anything).
2. **Voice** – female or male, plus one of four Gemini voices. Gender also decides how it speaks about itself in Urdu.
3. **Commander** – your name and title (Commander, Boss, CEO, or your own).
4. **Uplink** – a Gemini API key from https://aistudio.google.com/apikey (stored only on your machine).
5. **Home base** – where the ship's folders live.

Then comes the launch: countdown, liftoff, ascent, orbit. Every later start skips the launch and goes straight to the bridge.
Rename the AI, change gender or voice any time in **Settings**, or recommission from scratch there.

## Always on

- Closing the window sends it to the **tray**; it keeps running.
- **Ctrl+Alt+J** wakes it from anywhere and opens the voice session.
- "Start when I sign in" (installed builds) launches it hidden in the tray.
- Voice sessions close themselves after 10 quiet minutes (configurable) so you are not streaming audio all day.

## The crew

```
BridgeHome/
  jarvis/              the main AI
    brain/soul.md      its character. Edit it, it is read every session
    brain/memory/      things it remembers
    jobs/  skills/
  agents/<name>/       one folder per crew member
    agent.json  brain/  jobs/  skills/
  templates/agent-template/    copied for every new agent
  workspace/<name>/    where each agent saves what it makes
```

Say "create an agent called Alice, she's a market researcher" and Alice appears on the crew deck. Say "Alice, find today's dollar rate" and she works in the background, walks to her console, and reports back on her own.
You can also add crew with the **Add crew** button, and teach skills ("Alice, always cite sources") which become files in her `skills/` folder.

## Crew engine: Hermes Agent

Crew agents can run on **Hermes Agent** instead of the light built-in loop. Each agent becomes a Hermes profile with its own personality, memory, skills and workspace, and gets real tools: shell, files, code execution, browser.

1. Install Hermes and make sure `hermes --version` works. Bridge uses its own isolated `hermes/` folder inside the home folder and never touches your `~/.hermes`.
2. Install `aiohttp` in the same Python environment as Hermes (`pip install aiohttp`). Hermes needs it for its local API server.
3. Settings → Crew engine: pick **Hermes Agent**, choose a provider (Gemini, OpenRouter, Anthropic, OpenAI or a custom endpoint), a model and a key.
4. Press **Test engine**. It starts a profile, runs one real turn and tells you exactly which step fails.

Each agent's process starts on its first job and stops after 10 idle minutes. Live tool progress appears in the activity feed and the crew deck.

## Comms hub: Telegram, WhatsApp, Email

Systems panel → **Comms hub**. The AI gets its own inbox, run by a Hermes gateway (profile `comms`). Message it from your phone and it works on your PC.

- **Telegram** (fastest to set up): create a bot with @BotFather, paste the token, and add your numeric ID (from @userinfobot).
- **WhatsApp**: use a dedicated SIM. Press **Pair phone**, scan the QR with the AI's WhatsApp. WhatsApp can restrict unofficial bots, so never use your main number.
- **Email**: the AI's *own* mailbox (Gmail app password + IMAP/SMTP hosts). This is not your personal inbox.

Safety is built in: every channel requires an allowlist (strangers are ignored), risky shell commands ask for approval in the chat, destructive ones are denied, and the email channel never gets a shell. "Chat only" mode removes the shell from every channel. Bridge restarts the gateway if it crashes and shows live connection status.

## What it may do

| Tier | Examples |
| --- | --- |
| Free | web search, read inside the home folder, write inside the workspace, open web pages, open known apps |
| Asks you first | any shell command, reading or writing outside the home folder, scripts and executables |
| Blocked | `.ssh`, browser passwords, keychains, destructive commands (`rm -rf /`, `format`, `shutdown`...) |

Crew agents can never ask for extra access. Outside their workspace they are simply denied.
Tool calls show up in the comms log as they happen, and the AI is told never to claim an action a tool did not confirm.

## Check it

```
npm test        # 15 tests: agent folders, permissions, tool loop, jobs, comms settings, and real Hermes runs (skipped if Hermes is not installed)
```

Under Linux you can also drive the real UI headlessly and save screenshots:
`BRIDGE_SHOTS=/tmp/shots BRIDGE_USER_DATA=/tmp/ud xvfb-run -a npx electron --no-sandbox --disable-gpu .`

## Check local Hermes and Ollama

```
npm run doctor            # or: node scripts/doctor.js
node scripts/doctor.js --smoke --model qwen2.5-coder:7b
```

Read-only. It checks Hermes (version, config, profiles, API server), Ollama (running, models, context window, tool calling, streaming with many tools, thinking models) and writes `bridge-doctor-report.txt`. API keys are never printed.

## Build an installer

```
npm run dist        # Windows installer in dist/
```

## Known limits (read this)

- **Voice has not been run against Google's real servers.** It was tested end to end against a fake Live server (setup, mic streaming, tool calls through the permission engine, spoken replies, transcripts). The protocol follows Google's Live API reference. If voice is refused, open Settings and check **Voice model**. Google renames these often. The default is `gemini-3.8-live`.
- Urdu speech quality depends on the model. Try it and pick the voice you like best.
- There is no wake word yet. Wake it with the mic button or Ctrl+Alt+J.
- Agents are model loops with tools (files, shell, search). They cannot drive a browser or the desktop yet.
- Messages from Telegram/WhatsApp/Email are answered by the chat agent on its own. They are not yet linked to the Bridge crew ("ask Alice to..." from your phone). That is next.
- Reading *your own* Gmail or WhatsApp is not built. The Comms hub is the AI's own inbox.
- Telegram, WhatsApp and Email were not connected to the real services in testing (the test sandbox blocks them). Gateway start, live status, per-channel tool limits and crash restart were tested against a real Hermes.
- Scheduled jobs and reminders are not built yet.
- Windows is the target. macOS and Linux should run but were not tried beyond a virtual display.

## Next

1. Wake word ("Hey Nova") on-device.
2. Scheduled jobs and reminders.
3. Browser control for agents.
4. WhatsApp and Telegram bridge.
5. Richer crew deck (furniture, speech bubbles, more rooms).

# NeuralOps worker identity setup

Orbit now sends a separate NeuralOps AI identity for each worker. Existing NeuralOps connections need an explicit mapping before workers can use them; an unmapped worker is blocked rather than recorded under a shared identity.

1. In NeuralOps secure mode, use its administrator workflow to register a service identity such as `agent.orbit-broker` with `access: "broker"` and model `Custom`. Keep its token private.
2. Register distinct AI identities, for example `agent.laila`, `agent.alex` and `agent.bob`. Each must set `delegate: "agent.orbit-broker"`. Preserve their intended roles, reporting lines and authority; this change does not grant extra rights. Existing identities can have their delegate assigned through NeuralOps administration.
3. In Orbit, open Connectors > NeuralOps > Change token and save the broker token. Under Who can use it, map Laila and each worker to the matching AI identity and press Save worker identities. Display names are not used to infer identity. Blank mappings block access; duplicate identities and `human.*` mappings are rejected.
4. Start with a harmless `neuralops_whoami` call through each worker's connector. Confirm that Laila, Alex and Bob are different identities before doing real work. NeuralOps remains responsible for rejecting revoked identities or unauthorized delegation.

The connector Test button checks connection/tool discovery only. It does not prove worker mappings, task execution or completion verification. Human approval identities remain in NeuralOps' human workflow; Orbit cannot assign a human identity to an AI worker. Orbit's existing per-tool permission hub still applies.

Implementation uses the existing NeuralOps broker/delegate protocol (`X-Agent-Id`) and a separate upstream connection for each mapped identity. No new dependency or NeuralOps server change is required. This does not yet make NeuralOps clearance mandatory for every Orbit tool path, synchronize every Orbit job with a NeuralOps task, or give OpenCode/built-in workers new connector access.

Focused offline checks: `node --test --test-isolation=none test/neuralops-identity.test.js test/neuralops-connector.test.js` (Node 24). These use an in-memory MCP client substitute and DOM harness, not a running NeuralOps/Hermes server. See `project-update.md` for results and remaining verification.


## Worker-bound Orbit gateway access

Each Hermes worker now receives a token valid only for its own `/mcp/<worker-id>` address. The old shared browser token, commander/jarvis addresses and unknown workers are refused. Laila's internal main-process gateway calls are unchanged. The crew access check can initialize and discover browser tools but cannot execute browser or connector actions.

On the first Orbit restart with this change, a fresh private `browser/.actor-token-key` is created independently of the old shared token. Hermes profiles receive only their individual token through `ORBIT_GATEWAY_ACTOR_TOKEN` in their profile environment; configuration signatures refresh profiles for the next job. Stop existing jobs and restart Orbit before verification. A corrupt or unreadable private key fails startup rather than silently replacing identity credentials.

This protects the HTTP actor boundary; it is not filesystem isolation. A worker with unrestricted access to another profile or the private key can still steal credentials. Windows ACLs, real Hermes environment interpolation and the full Electron/HTTP flow need verification. Removed worker IDs reject future requests; re-creating the same ID under the same key reuses its token. In-flight actions are not cancelled by identity removal.

Focused offline verification: `node --test --test-isolation=none test/gateway-auth.test.js test/neuralops-identity.test.js test/neuralops-connector.test.js`. The gateway tests use in-memory HTTP/profile harnesses. Real socket regressions are added to `test/browser-mcp.test.js` but were not executed under the audit restrictions.

## Run-scoped worker gateway access

Each started Orbit job gets a persisted `runId`. The main process binds worker MCP credentials and asynchronous tool requests to that execution generation. Credentials expire on cancellation, completion or failure, and change for the next job. Old requests waiting for a body or a user decision cannot inherit the next job's access. Progress/text/checkpoint callbacks from stopped executions are ignored. Hermes reuses its existing profile-signature mechanism to refresh the token on the next job; this can restart that worker's server.

This is an execution-lifetime guard for Orbit-mediated calls, not a complete NeuralOps task-authorization integration or an OS sandbox. It cannot undo an already dispatched action or contain external engines' direct filesystem/shell tools. Queues and recovery remain as before. `bridge-check` stays discovery-only; internal Laila/user controls do not require a worker job.

Offline checks: `node --test test/job-runs.test.js test/gateway-auth.test.js test/neuralops-identity.test.js`. These use memory transports and engine doubles. Full-suite, Windows, real HTTP and real Hermes/OpenCode validation remain pending; no dependency installs or model calls were made for this change.
