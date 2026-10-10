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
