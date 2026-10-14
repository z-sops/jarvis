# Native storage acceptance fixture

This owner-run checker creates a NEW temporary Home. It does not accept an existing Home, install/pull images, contact a live provider, prune Docker, or alter production profiles. Existing containment, actor-scoped MCP, native private snapshots, admission and retention are reused.

Each task uses the actual selected installed CLI, reads a real owning-actor MCP marker, saves private/workspace state, stops its container and resumes the same private session in a new container. Checkpoints remain accumulated. After the requested tasks, a further protected task releases only synthetic accepted/40-day-old completed fixture recovery, then resumes its native session AFTER retirement. Interrupted originals/referenced recovery remain protected. Retirement records use the existing trusted release service in an isolated test, NOT a model tool or real human approval. The test deliberately creates `fixtureSyntheticAcceptance` records; these never imply live approval enforcement.

Workers are 1 or 5 identities assigned sequentially round-robin. This is storage accumulation, not parallel throughput or production scheduler validation. Each task creates original/retry records; 100 tasks plus the final probe normally creates 202 durable jobs. Actual TODO writes, arbitrary plugins, real provider budgets, physical outages, full-disk ENOSPC and production key lifecycle remain separate acceptance work.

The checkpoint encryption key exists only in the benchmark parent's memory. The native restart is a new container and fresh Home object, NOT an OS-keystore or parent-process crash test. Retained private encrypted fixtures cannot be decrypted after the parent exits. The report contains counts/checks/metadata, not raw messages, secrets or keys.

Measurement reports Home logical/allocated bytes, DB/WAL/SHM categories, events/jobs/library/vector filename observations, checkpoint state footprint and checkpoint METADATA bytes (which include encrypted private recovery and other metadata, not a pure private payload measurement). Docker `system df` is shared daemon accounting, not Orbit-exclusive image/cache attribution or VM physical disk usage. Exact recorded container names are checked absent; no prune occurs. Images/cache remain installed. Net reclaimed Home bytes include retention receipt growth; shared free-disk delta is noisy. All samples are bounded/non-atomic. Inventory/retention bounds can reject large cases instead of passing incomplete measurement.

## Windows sequence

First clean-update the existing test checkout, then smoke one engine at a time. Use your already installed immutable image:

```powershell
& {
    $repo = 'G:/jarvis-containment-check'
    $changes = git -c "safe.directory=$repo" -C $repo status --porcelain
    if ($LASTEXITCODE -ne 0 -or $changes) { throw 'Repository check failed or local changes exist.' }
    git -c "safe.directory=$repo" -c gc.auto=0 -c maintenance.auto=false -C $repo pull --ff-only
    if ($LASTEXITCODE -ne 0) { throw 'Update failed.' }
    node "$repo/scripts/native-storage-benchmark.js" 'sha256:018544b25065b555d1a913373bc8164eebe0280794ec8ae92fbfed6acab4e6d8' --engine opencode --workers 1 --jobs 1
    if ($LASTEXITCODE -ne 0) { throw 'Smoke failed; share complete output. Fixture retained.' }
}
```

After smoke PASS, change `--jobs 1` to `--jobs 100`. Run separate cases for `--workers 1` and `--workers 5`, and `--engine hermes` / `--engine opencode`. Each case creates a distinct disposable fixture. Progress prints per task; report JSON/path prints at completion. Stop on failures; no automated destructive retry/cleanup. Runtime grows with task count and every task includes a native restart.

A one-job `passed_fixture` is smoke evidence only (`full100JobFixture:false`). Even all four 100-task cases passing proves only these deterministic native fixtures. It does not prove arbitrary real task storage stays bounded; protected interrupted recovery remains retained, quota can eventually refuse work, and external stores remain excluded. Review actual measured totals and protected state before beta acceptance.

## Development evidence

Local orchestration tests use an explicitly labelled SIMULATED runner and synthetic checkpoint payloads. They cannot verify native CLI/private-state compatibility. This development environment has no Docker CLI; actual owner execution remains pending.
