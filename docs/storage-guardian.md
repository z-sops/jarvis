# Storage Guardian — measured foundations, not release acceptance

## Storage ownership found in Orbit

| Store | Ownership and current behavior | Remaining risk |
| --- | --- | --- |
| Contained Hermes/OpenCode database | Fresh per-run `/home/orbit` tmpfs, 128 MiB; known native session restored from encrypted checkpoint | Capacity exhaustion can interrupt a job; this is not the owner's standalone 5–10 GB OpenCode home |
| Private recovery database | Existing SQLite backup/sanitizer; encrypted inside workspace checkpoint, 8 MiB private-state bound | Bound refuses oversized history; it is not an automatic retention policy |
| Jobs and transition history | Per-worker `agents/<id>/jobs/*.json`; last 100 transitions per job | Number of jobs and associated checkpoints can grow |
| Native candidate snapshots | Job/run-owned copies; existing cleanup removes replaced candidates for that run | Referenced historical recovery/retry snapshots cannot be removed merely by age |
| Action log | Existing 2 MiB rotation plus previous file; convenience log, not NeuralOps ledger | Other runtime logs/records need measurement |
| Knowledge and memory | Shared scoped Library passage files; per-worker notes, commander topics; BM25 index in memory | Persisted passage/topic growth and in-memory index use remain separate |
| Vector memory | Orbit Library does not create a persisted embedding/vector index | Native plugins and external NeuralOps databases are outside that claim |
| Docker | Shared installed images, writable layers, volumes and build cache | Daemon totals are not additive per-agent usage; Docker Desktop VM disk size is separate |

Existing drive-free-space meter is reused conceptually; the new helper measures Orbit-owned categories rather than introducing another database or scheduler. No writable native SQLite DB is shared between isolated workers. External NeuralOps/standalone native homes need their own explicitly selected samples; they are not silently inspected.

## Measurement

`node scripts/storage-check.js <Orbit home> [--docker]` prints a bounded read-only metadata sample: logical/allocated bytes where available, free bytes, DB/WAL/SHM, events, jobs, checkpoints, knowledge, filename-classified vectors, memory, workspace and other bytes. Worker attribution covers their agent/workspace folders only; shared checkpoints are not guessed into worker totals. Files/links/errors/entry or time bounds make coverage incomplete and exit code 2. No filenames, paths, database contents, tokens or event payloads are printed. Logical bytes include complete serialized event files, not a separate semantic payload breakdown.

Samples are not atomic while writers run. Filename classification does not detect vector BLOBs inside arbitrary DBs. Disk allocation/dedup/compression can differ from logical bytes. Docker sampling explicitly uses the fixed local engine and `system df`; never prune/pull/build. It reports shared human-readable totals separately, not a precise Docker VM footprint or worker charge.

Read-only owner Windows sample, using the **actual configured Orbit home** (not repository directory):

```powershell
$homeToMeasure = Read-Host "Actual Orbit home directory"
node "G:/jarvis-containment-check/scripts/storage-check.js" $homeToMeasure --docker
```

Retain private before/after samples during one-agent and five-agent representative tasks. Measure runtime roots, workspace, semantic/vector stores and Docker/VM disk separately; report unknown coverage. Do not post databases or logs containing personal data. No live/paid workload is automatically started by this script.

## Safe retention decision

Independently inspected upstream OpenCode tag 1.18.35, commit `53d1eabb61e21162157817bf677da0a4ad3332e3`: `packages/core/src/session/sql.ts` includes session/message/part/TODO, session_message, queued session_input and context epochs; message/TODO relationships use cascade deletion. SQLite Node adapter enables WAL for writable connections. These are source observations, not runtime schema/version authentication.

References:
- https://github.com/anomalyco/opencode/blob/53d1eabb61e21162157817bf677da0a4ad3332e3/packages/core/src/session/sql.ts
- https://github.com/anomalyco/opencode/blob/53d1eabb61e21162157817bf677da0a4ad3332e3/packages/core/src/database/sqlite.node.ts
- https://www.sqlite.org/wal.html
- https://www.sqlite.org/backup.html
- https://www.sqlite.org/lang_vacuum.html

WAL contains committed changes not yet consolidated into the DB. It is not compression; never delete it manually. Deleting rows does not necessarily shrink the file. Retention needs an authenticated native version/schema, active/queued/retry/TODO and recovery-reference protection, exact checkpoint binding and budget/approval continuity. Age alone is insufficient. Unknown plugin schemas stay blocked.

`lib/storage-sqlite.py` is an offline inspection/archive primitive, **not connected to automatic production cleanup**. Online backup includes committed WAL, excludes uncommitted changes, checks integrity/foreign keys, schema and a bounded logical hash of every row (including implicit ROWIDs), and compacts only already-free pages on a private COPY. No source DELETE/VACUUM/checkpoint/replacement and no actions run. If VACUUM renumbers implicit ROWIDs, changes row contents, or verification bounds cannot cover unknown tables, publication refuses. It preserves all rows, active sessions, TODOs and unknown tables on an accepted archive; `pruneAllowed` is always false. Shape matching is not an authenticated CLI version. Archive default is bounded at 1 GiB; it reserves approximately three times snapshot size plus 64 MiB free headroom. Existing destination/link/lock/integrity/timeout/space failures refuse publication. SQLite read-only connections may manage SHM; this is not a byte-for-byte sidecar immutability guarantee.

Publication follows copied DB flush, manifest flush and hash/integrity verification, then same-filesystem directory rename. Crash before publication leaves owned staging/reservation for inspection; it never automatically replays cleanup. No original data is deleted. Directory fsync/physical outage durability is not proved. Archives contain **sensitive raw database data**, including unknown metadata; mode 0600 is not verified Windows ACL protection. They are fixture/offline engineering inputs, not encrypted product archives or directly resumable checkpoints. Product retention must reuse existing protected storage before production exposure; no permission/credential/action restoration from archives.

Copy compaction may shrink an archive relative to a DB with free pages; creating an archive increases TOTAL disk usage until a separately proven safe retirement policy exists. No disk-saving, enforced aggregate quota or beta readiness claim.

## Offline evidence, 2026-10-11

`python -B scripts/storage-benchmark.py` owns disposable fixtures only. Actual SQLite commits, WAL/SHM, event/passage files and copy archives; 4 batches, 50 synthetic messages per worker/batch. Vector bytes zero because no vector index is fabricated. This is not real native-agent execution or a long-running benchmark.

| Workers | Committed fixture messages | DB before writer close | WAL before close | SHM | DB after close | WAL after close |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 200 | 4,096 B | 358,472 B | 32,768 B | 294,912 B | 0 B |
| 5 | 1,000 | 20,480 B | 1,792,360 B | 163,840 B | 1,474,560 B | 0 B |

Events: 208/1,040 B; passage files: 3,776/18,880 B. Archives add approximately 289 KiB/1.41 MiB including manifests; they do not reduce total usage. Closing writers consolidated this fixture's WAL; long-lived readers/writers can behave differently.

Three Node tests plus six actual Python SQLite scenarios passed: coherent committed WAL/uncommitted exclusion, pending TODO/history preserved, fresh-process archive verification and existing native helper fixture restoration; free-page compaction without source shrink and refusal when unknown plugin ROWIDs change; real exclusive DB lock and simulated low-space preflight refusal; corrupted archive/source rejection; parent-killed archive process at reserved/copied/verified stages preserving source and blocking stale-reservation replay; existing destination/symlink refusal. No physical low-disk ENOSPC, outage, native CLI resume, Windows ACL or live provider proof. Native helper restoration is not the actual native engine resuming.

## Release gate still open

Actual one/five-agent long-running Windows runs, native version/schema inspection of the selected runtime, per-phase disk peaks (including encrypted checkpoints), semantic/vector extension footprint, Docker/VM growth, bounded protected retention with reference reconciliation, real native TODO/session resume after retirement, forced crashes at native/workspace/ledger boundaries, real low-space/write failures and Windows restart acceptance. Existing owner native/keystore PASS retains its earlier scope; these storage changes do not extend it.

HiClaw message routing/handoff/recovery will map to existing NeuralOps actor identities, typed acts, approval gates and ledger. No communication framework or second scheduler was added in this storage increment.

Archive hashes detect accidental corruption; an unprotected manifest is not authenticated against an OS-level attacker rewriting both files. Protected production archives and key lifecycle remain separate release requirements.
