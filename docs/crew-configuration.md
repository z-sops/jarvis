# Versioned crew configuration

Settings → **Crew configuration (YAML)** exports the currently stored crew configuration. Load or edit a document, press **Preview changes**, inspect the field diff, then explicitly **Apply reviewed changes** within five minutes. Editing the document invalidates its preview. Export downloads stored configuration, not unsaved editor text.

YAML is input/export only. `agents/<id>/agent.json` and `library/assignments.json` remain authoritative for accepted settings. Existing jobs, run records and permissions retain their own authority. No file watcher, alternate scheduler, HiClaw integration or automatic configuration replay is introduced.

Version 1 supports up to 50 **existing** workers and 64 KiB UTF-8 documents. Create workers with **Add crew** first. Omitted workers remain unchanged; this is not a delete or replace-all operation. Each listed worker supplies all four config fields and both assignment lists. `null` means inherit crew defaults; empty assignment lists explicitly remove shared assignments. Library references must already exist. Built-in workers require Gemini.

```yaml
schemaVersion: 1
revision: REPLACE_WITH_THE_64_CHARACTER_REVISION_FROM_EXPORT
workers:
  - id: alex
    config:
      engine: hermes
      workerProvider: gemini
      workerModel: example-model-id
      workerContext: null
    skills: [code-review]
    packs: []
```

This is an illustrative document, not directly importable: use your exported revision, actual model ID and existing Library skill IDs. No provider availability or skill expertise is established by applying it.

The revision hashes existing worker records, Library catalog/assignments and current settings internally. Credentials and custom endpoint values are excluded from exported fields/diffs; their changes still invalidate a preview. Unknown fields, credentials, permissions, approval grants, shell commands, runtime status, identities outside the crew, duplicate IDs/keys, aliases/anchors and unsupported tags are refused. Parser errors do not echo document content. The installed and already locked `js-yaml` 4.3.2 parser is now a pinned production dependency; no new package download was performed.

Apply is available only through the current main-window/main-frame IPC bridge, not model tools. It rechecks revision, preview lifetime and idle state. Active typed chat, pending workers/QA, queued/running/retrying jobs or recovery faults block changes. Each worker uses existing `Home.updateAgent` credential protection and `Library.setAssignment`; assignment replacement now uses the existing flushed atomic-write helper.

Before the first configuration write, a flushed apply intent is stored in `logs/crew-config.json`. This bounded receipt history records the document hash, exact public diff, applied-worker progress and final read-back verification. It is **not** another configuration source or a replay manifest. Successful imports also appear in the existing action log. Ordinary model file tools cannot edit/read this receipt file; local filesystem access is not tamper-proof.

On failure or crash, some settings may already have changed. Prepared/partial receipts block additional imports **and new/retried worker execution**. Reopen this screen, reload the actual stored export, inspect the incomplete history and current settings, then check the inspection checkbox and press **Record inspection**. The decision is bound to the current revision and exact unresolved receipt IDs. It records acceptance of the inspected current state, not completion of the original import or an automatic rollback/retry. Prepare a fresh document for further changes. Restart never restores preview tokens or approval grants.

Each replaced file is flushed/atomically renamed; a batch across worker and assignment files is **not** one filesystem transaction. Windows directory flush and physical power-loss durability remain unverified. Serialization assumes Orbit's existing single main process; arbitrary concurrent external file writers are outside this guarantee. If the history is damaged/unreadable, jobs/imports fail closed and manual inspection/repair is required rather than deleting the evidence automatically.

Outside version 1: worker creation/deletion/renaming/role edits, team leaders, desired-running-state reconciliation, lifecycle start/stop commands, credentials/connector permissions, container image changes and native private-session state. Continue using their existing controls. No claim that the broader HiClaw-inspired architecture is complete.

## Interrupted-import reconciliation

The recovery screen compares the **actual current persisted public configuration** against per-worker before/after hashes recorded before apply. It lists every worker selected by the document (including workers with no requested changes):

| Status | Meaning |
| --- | --- |
| Requested settings match | Current configuration matches the intended after-state. |
| Unchanged | Current configuration matches its recorded before-state. |
| Partially changed | Some requested fields match before and others after; unrelated fields still match the before-state. |
| Configuration drift | Current state cannot be explained by that recorded transition. |
| Worker missing / Unknown | The outcome cannot be inferred safely. |

Separately, **Progress recorded** reports whether the worker completion was flushed into the receipt. A crash can leave a successful setting write ahead of this progress record; reconciliation reads actual files rather than assuming the progress counter is complete. Matching state does not prove which process made a change.

Each report shows the base configuration revision, current persisted revision and requested document hash. The document hash identifies the intended input; it is not invented as a successful resulting revision. Older intents without worker hashes remain explicitly unverified. Reconciliation is read-only, not automatic completion/replay. Rollback safety is **not established** because there is no complete protected-state rollback snapshot or cross-file transaction. Explicit user inspection remains required.

Offline tests exercise an abrupt child-process exit on worker4 of5, plus exit after worker3's durable changes but before progress publication. Restart checks the actual applied/partial/unchanged classifications, drift detection, untouched receipt bytes and job quarantine. This is process-crash evidence in temporary homes, not a physical power-cut or Windows durability result.

## Reviewed public-settings rollback

For one original incomplete import, **Preview settings rollback** reconstructs its public before-state from the recorded diff. Both complete before/after hashes must agree and every current changed field must equal a recorded before/after value. Missing workers, drift, legacy/malformed intent, unavailable Library references or incompatible effective defaults refuse rollback. Multiple or linked incomplete receipts require explicit current-state inspection instead.

The preview is read-only and bound to the complete current revision and receipt-history hash. Within five minutes, **Apply reviewed rollback** rechecks these guards plus all existing idle/recovery checks. It restores only engine/provider/model/context and shared Library assignments using the same Home/Library write path. Credentials, permissions, jobs and private engine state are never restored. Closing/editing/reloading cancels the preview.

A separate prepared rollback receipt links the original intent before any reverse write. Read-back success resolves the original as `rolled_back` and the reversal as `applied` together in one atomic receipt-file replacement. Failure/crash leaves unresolved evidence and job quarantine, even when the settings already match the requested reversal. Restart does not resume rollback. Inspect both linked receipts and current state before recording acceptance. This is a reviewed public-settings reversal, not a complete protected-state snapshot, automatic recovery or a multi-file transaction.
