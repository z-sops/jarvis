# Candidate native runtime image

Status: recipe implemented; image build, native gateway startup, and real task/provider/MCP compatibility **unverified**. No dependencies were installed while preparing this recipe. This adds build tooling only; Orbit still uses its existing containment runner, broker, jobs and gateway.

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
