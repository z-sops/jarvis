# Candidate native runtime image

Status: user-reported Windows candidate image build and both CLI/isolation checks **passed**. Real native task/provider/MCP compatibility remains **unverified**. No dependencies were installed in the remote coding environment. This adds build tooling only; Orbit still uses its existing containment runner, broker, jobs and gateway.

The user's installed Python3.11/Node20 base passed real Windows isolation diagnostics but lacked both selected CLIs. This recipe installs OpenCode1.18.35 (official Linux x64 baseline binary) and Hermes0.21.6 (exact source commit818c13be1dc4fd28987e1e881a9408224afd4535) into a separate image. The baseline OpenCode artifact avoids an AVX2 CPU requirement. Hermes's release lock selects Python>=3.14, so its isolated interpreter is Python3.14.7+20260901; the existing base interpreter is retained only for build staging. Python and uv0.12.3 artifact URLs/hashes come from that Hermes commit's pm/lock.json. OpenCode archive SHA256 comes from the official GitHub release asset digest. See runtime-lock.json.

Hermes dependencies use its frozen upstream uv.lock with web/MCP/PTY/cron extras and --no-install-project. Hermes itself runs from the pinned source through the fixed PYTHONPATH/interpreter wrapper; no project wheel is built. The upstream setup.py explicitly blocks wheels outside Nix; no bypass variable is used. This pins application dependency resolution; it does not establish byte-for-byte reproducible image builds or fully pinned upstream build-backend requirements. The source retains upstream licenses inside the image. No third-party application source is added to the Jarvis repository.

## Review and build

Building downloads official GitHub release binaries/source and locked Python dependencies. It consumes disk/network and executes trusted upstream package build code **inside the image build**. Installation approval is required before invoking the build script. It does not install host CLIs or npm packages, send model requests, publish an image, or edit Orbit settings. No API keys are needed.

Only Linuxamd64 on Docker Desktop's local Linux engine is supported by this recipe. The wrapper requires the already-installed base tag to match image ID sha256:8f958bdc1b4a422bfafd97cab4f69836401f616ae985d4b57a53d254f5bcb038 before and after building; a missing/mismatched base aborts. It uses --pull=false. Do not retag/change the base during a build. No new image-base pull is intended. The base must already contain git; the build fails rather than apt-installing it automatically.

After approval, from the updated separate verification checkout:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-native-runtime.ps1
```

ExecutionPolicy Bypass applies only to this reviewed script process; it does not change the machine policy. The build context contains only Dockerfile, runtime-lock.json and the artifact installer; it excludes host checkout files and credentials. Binary archives are checksum-verified before data-filtered extraction. The final image defaults to numeric non-root UID10001. The existing Orbit runner supplies read-only filesystem/no-network/resource controls, scoped relay and writable tmpfs; Dockerfile defaults alone do not establish containment.

The build includes an offline --version/import smoke. The wrapper then runs both existing contained CLI/isolation diagnostics through scripts/native-runtime-check.js. Any failure stops without changing application configuration. Save the printed sha256 image ID for later explicit configuration, not just the mutable build tag. Buildkit is required for RUN --network=none. No Docker daemon or PowerShell is available in the remote coding environment, so Dockerfile execution and PowerShell parsing have not been verified here.

## Evidence gates after build

1. Both contained CLI/isolation checks must pass. Version availability is not native task compatibility proof.
2. Offline startup must reach Hermes's authenticated API and OpenCode's custom provider with a disposable loopback fixture, then reach the existing actor/run-bound MCP relay; no production credentials or paid provider calls. This gate is not implemented by --version/import checks alone.
3. Explicitly authorized real-provider jobs must verify budget reservation, usage settlement, cancellation, permissions and artifact evidence.
4. Disposable workspace pause/restart/network-loss checks and separate physical Windows power-loss verification remain necessary. Private native databases/plugins are not restored by file checkpoints.

If the lean Hermes environment lacks another required dependency or lazy manager assembly step, fix the reviewed pinned recipe and repeat offline diagnostics; do not allow runtime downloads or disable containment. Images are candidates until these gates pass.

Offline local verifier tests: python3 test/native-runtime-artifacts.py. They prove checksum/tar guards and recipe consistency, not actual installed CLI behavior.

Official references inspected 2026-10-10:
- https://github.com/NousResearch/hermes-agent/releases/tag/v0.21.6
- https://github.com/NousResearch/hermes-agent/blob/818c13be1dc4fd28987e1e881a9408224afd4535/pyproject.toml
- https://github.com/NousResearch/hermes-agent/blob/818c13be1dc4fd28987e1e881a9408224afd4535/pm/lock.json
- https://github.com/anomalyco/opencode/releases/tag/v1.18.35
- https://docs.astral.sh/uv/reference/cli/#uv-sync

## First Windows build evidence — 2026-10-10
The user ran checkout de6c019 on Docker Desktop. Base resolution, checksum-verified artifacts and the pinned Git source step succeeded; dependency sync failed because --no-editable asked uv to build a Hermes wheel, which upstream setup.py rejects. The recipe now uses --no-install-project, matching the dependency-only intent of upstream Docker assembly. Existing source wrapper is retained. This fixes the reproduced recipe cause, but the corrected image build/startup is not yet verified. Repeat the existing build wrapper after a clean fast-forward; Docker may reuse the completed prior layers. Do not disable the upstream guard or use HERMES_NIX_BUILD as a workaround.

## Windows CLI/isolation PASS and offline native task diagnostic
On 2026-10-10 the user reported built image orbit-native-runtime:hermes0.21.6-opencode1.18.35 (short ID80eebf6352fc,3.81GB). Both checkRuntime results passed every required boolean: Hermes Agent v0.21.6 (upstream818c13be), OpenCode1.18.35. This supersedes image build/CLI availability as unverified for that user-tested candidate; its full immutable ID was subsequently reported as sha256:80eebf6352fc1290a6ed7111803007b921d303855008a800abf2c0a70682148a. Real task/provider/MCP behavior is still separate.

The new scripts/native-task-check.js accepts the installed full sha256 image ID. It creates a disposable synthetic Home and one job at a time, starts the existing owned container, uses a deterministic in-process OpenAI-compatible model fixture (including SSE), and routes a read_fixture tool through the existing actor/run-authenticated Orbit MCP server. It checks the real CLI returns that actual tool result to its model, emits the fixture marker, preserves input, saves a file checkpoint and stops the container. Eight synthetic model requests maximum and a90-second native task deadline per engine. No real credentials or external model fetch; production Home/settings remain separate. Input fixtures are synthetic and deleted only after owned cleanup is confirmed; uncertain cleanup retains the diagnostic home for inspection.

```powershell
$image = docker --host npipe:////./pipe/dockerDesktopLinuxEngine image inspect orbit-native-runtime:hermes0.21.6-opencode1.18.35 --format '{{.Id}}'
if ($LASTEXITCODE -eq 0) { node .\scripts\native-task-check.js $image }
```

This exercises actual native CLI/MCP/file-checkpoint plumbing with a local model fixture. It does not prove AI reasoning, live provider compatibility, real token billing/budget enforcement, human approvals, browser actions, cancellation/restart or physical power-loss recovery. The host model broker is intentionally replaced by a deterministic fixture here; production broker policy remains a separate evidence gate. Native task diagnostic itself has not been executed remotely (Docker unavailable). Offline fixture/containment regression:29/29 pass.


### 2026-10-10 — Actual Windows native task failure and checkpoint flush fix
The user ran scripts/native-task-check.js after updating to b0aaede on Windows Docker Linux29.5.3 with candidate sha256:80eebf6352fc1290a6ed7111803007b921d303855008a800abf2c0a70682148a. Both engines failed at native_task with EPERM: operation not permitted, fsync; Hermes made zero synthetic model requests, OpenCode one, and neither made an MCP call. Earlier CLI/isolation PASS remains valid; task/MCP compatibility is not established.

Checkpoint regular files were opened read-only before fsync. Windows FlushFileBuffers requires GENERIC_WRITE (Microsoft API documentation); changed only these regular-file handles to r+ without truncation. Mandatory file flushing remains fail-closed. A regression also found queued protocol frames could continue after the first checkpoint error: the existing frame processor now rejects further frames after failure/closure, preventing queued broker or MCP actions. Offline regressions reproduce the original Windows handle requirement and prove a file flush failure prevents checkpoint publication, broker submission and candidate application.

Focused checks:31/31; expanded Node suite:567 total,564 pass,0 fail,3 real-Hermes skips. JavaScript syntax checks pass. These are remote offline fixtures, not a Windows retest. Update the clean verification checkout and rerun native-task-check.js with the same immutable image; no rebuild/install/provider call is needed for this host-side fix. Physical power-loss/directory durability and production provider/budget/approval/crash evidence remain separate.


### 2026-10-10 — Post-flush real native task failures and safer diagnostics
User updated to6bbd6bb and reran the same installed sha256:80eebf6352fc1290a6ed7111803007b921d303855008a800abf2c0a70682148a candidate. The prior fsync EPERM no longer appears; Hermes fails with generic Isolated runtime failed (zero synthetic model requests), OpenCode reaches one synthetic model request but does not expose the read_fixture MCP tool, and neither executes an MCP call. This establishes new blockers, not native task/MCP PASS or power-loss proof.

Runner now returns405/Allow:POST for authenticated optional MCP GET/DELETE on the existing stateless relay and disables OpenCode OAuth for the fixed token-authenticated local server. Earlier400 behavior was a protocol compatibility gap; whether it caused this specific discovery failure remains unverified. Actor/run authentication, POST-only forwarding, no direct network and other bounds stay enforced. No speculative Hermes dependency/install fix is applied without actual failure evidence.

Only fixed runtime phase/error-category diagnostics are returned, never native stdout/stderr logs, paths or secrets. Offline task reports bounded known MCP methods/HTTP status/tool counts and model function/fixture counts, without tool arguments or model bodies. Hermes native startup root cause still needs the refreshed real diagnostic; remote Docker/CLIs are unavailable.34 focused offline checks and five syntax checks pass. Update the separate clean verification checkout and rerun the same task script; runner is read-only mounted, so no image rebuild is needed.

Validation follow-up: expanded Node suite570 total/567 pass/0 fail/3 real-Hermes skips (43.4 s); npm test528 total/525 pass/0 fail/3 skips (40.4 s). These are offline fixture regressions, not native Docker task PASS.


The mounted runner now sets gateway.multiplex_profiles=false for its isolated Hermes single-worker home: the pinned gateway defaults to multiplexing and otherwise reloads credentials under a profile scope that need not contain the generated environment-only API-server key. It also checks OpenCode's fixed Orbit MCP connection with native mcp list before task submission. These changes require no image rebuild. The reported6a29d22 Windows task failures remain the latest actual task evidence until retested; CLI/isolation passes and local SDK relay checks are not native task success. Raw CLI logs stay inside the disposable runtime; only fixed readiness categories and bounded health/exit details are returned.


## Native task fixture and relay correction — 2026-10-10

- Actual Windows e43ea1f result remains FAILED for both engines: Hermes alive without health response; OpenCode readiness connected but task fixture stopped on a zero-tool request. No native task, provider or approval PASS.
- Pinned OpenCode runs a separate title-generation request with no tools. The fixture now recognizes only its bounded known title pattern, returns a synthetic title, and counts task evidence separately. All other missing-tool requests still fail; title generation never satisfies MCP/result/file evidence. Its involvement in the actual Windows failure is plausible, not yet proven by a successful retry.
- A held broker request reproduced a real relay defect: concurrent MCP returned400. The relay now admits at most8 requests, rejects excess with429, and preserves serialized host processing, checkpoints and failure latch. Offline regression passes; native compatibility remains pending.
- Hermes startup diagnostics project fixed states/milestones from bounded regular private logs/state; raw logs and unknown strings cannot cross the boundary. The host independently validates the projection.
- Recipe gap: upstream API server requires aiohttp; the original web/mcp/pty/cron extras do not explicitly provide it and import alone tolerated absence. Add the pinned upstream sms extra (aiohttp dependency only; no SMS service enabled) and assert API-server requirements in offline build smoke. Existing image dependency availability remains unverified; a new image is not built automatically.

Before rebuilding, the existing candidate can be checked without downloads, credentials or provider calls:

```powershell
docker --host npipe:////./pipe/dockerDesktopLinuxEngine run --rm --network none --read-only --user 10001:10001 --cap-drop ALL --security-opt no-new-privileges --pids-limit 64 --memory 512m --cpus 1 --env PYTHONPATH=/opt/hermes --env PYTHONDONTWRITEBYTECODE=1 --entrypoint /opt/hermes/.venv/bin/python sha256:80eebf6352fc1290a6ed7111803007b921d303855008a800abf2c0a70682148a -c "import aiohttp; from gateway.platforms.api_server import check_api_server_requirements; assert check_api_server_requirements(); print('Hermes API dependency check passed')"
```

Failure here identifies packaging readiness, not every startup cause. Rebuilding via the existing reviewed PowerShell wrapper downloads/installs dependencies inside a new image and requires installation approval. Existing immutable image remains available; record and test the new image ID separately.


## Actual Windows OpenCode task PASS; Hermes deferred-tool fixture — 2026-10-10

- User updated separate verification clone to5639e16 and rebuilt reviewed image successfully. New immutable ID: sha256:018544b25065b555d1a913373bc8164eebe0280794ec8ae92fbfed6acab4e6d8. Both engines passed all15 CLI/isolation checks; offline build API dependency assertion passed.
- OpenCode real contained native task PASSED all6: native response, owning-actor MCP, model received tool result, unchanged input, saved checkpoint and stopped container. Actual MCP tools/call200 observed. Three deterministic model requests comprised2 task +1 title. This verifies this offline task only; no live provider/billing/human approval proof.
- Hermes API health now200, gateway running/api connected and MCP registration observed. Startup dependency blocker cleared in this run. Task still FAILED:17 exposed functions,0 direct fixture names,1 deterministic model request,0 MCP calls. Do not claim Hermes task PASS.
- Pinned Hermes818c13be tools/tool_search.py defaults MCP deferral on: model sees tool_search/tool_call bridges instead of direct MCP names. Original diagnostic demanded an eager fixture schema and falsely rejected this supported surface. Fixture now requests bounded native search, validates one scoped mcp__orbit__read_fixture catalog match with no required arguments, then invokes the real native tool_call bridge. No invented catalog, marker or MCP result. Wrong server, missing evidence, required arguments, repeated bridge without execution and absent actual marker all fail. Actual Windows bridge compatibility remains pending.
- Production engine/tool discovery settings and permissions are unchanged. No image rebuild required for this mounted diagnostic correction. Keep resource/network/actor/run/checkpoint/approval controls.


## Both real contained native offline tasks PASS on Windows — 2026-10-10

User updated verification clone to30a1e46 and tested immutable image sha256:018544b25065b555d1a913373bc8164eebe0280794ec8ae92fbfed6acab4e6d8. Hermes AND OpenCode report ok:true and all6 acceptance checks true: nativeResponse, owningActorMcp, modelReceivedToolResult, unchangedInput, checkpointSaved, containerStopped. Both show actual MCP tools/call200. Hermes health200, gateway running/api connected;3 task model requests exercised native tool_search/tool_call (17 exposed functions,0 eager fixture names). OpenCode3 model requests comprised2 task +1 title, task-session initialize/initialized/tools-list/tools-call successful. Earlier missing aiohttp packaging, auxiliary-title fixture and deferred-tool fixture blockers are resolved for this specific diagnostic.

Scope: real contained native CLI plus deterministic local model, existing owning-actor MCP, file checkpoint and confirmed container stop. No live provider, real billing, production native budget, human approval, browser, cancellation/crash/power-cut or private engine-history restoration proof. Hermes startupMilestones.gatewayRunning:false is an earlier bounded log observation; it does not override gatewayState:running, health200 or final stopped-container evidence. Do not infer a new failure from that snapshot. No source change, install or redundant test run needed for this evidence update. Keep draft PR, original application and production settings untouched. Next integration evidence should use existing test/approval/budget/recovery services rather than duplicate infrastructure.

Private state adapter: enable the existing `nativeContinuity` setting for bounded encrypted native SQLite/session/TODO checkpoints. Only Hermes0.21.6 and OpenCode1.18.35 are accepted by this adapter; other CLI versions fail closed. The application-owned Python helper is sent into the existing container and uses the image's Python stdlib SQLite online-backup API; no host Python execution, extra mount or dependency install is needed. Session databases and Hermes memory files are allowlisted, at most8MiB in total. Config/auth/plugin code/response caches are not imported. Permissions/queues/runtime leases are retired; uncertain actions block. Run `node scripts/native-task-check.js IMAGE --private-continuity` for the separate offline real-CLI explicit-restart test. Previous task/CLI PASS does not establish this new recovery capability.
