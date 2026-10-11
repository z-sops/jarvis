# Real issue fixes and project decision gates

This increment strengthens existing workers, project cards, browser permissions and review evidence. It introduces no alternate scheduler or copied external framework.

## Planning and completion

New `plan_project` tool proposals require measurable `business.successCriteria` before project execution or staffing. Recorded `business.unknowns` block direct dispatch, finite coordinator approval and staffing. `get_project_plan.executionReadiness` explains the blockers. Missing details should be clarified with the user; a model must not fabricate requirements just to clear the gate.

`refine_project_brief` updates only an undispatched draft with an exact `briefRevision`. It validates the same bounded business fields, refuses a changed revision, and cannot change an already dispatched/approved coordinator scope or incomplete staffing. Refinement is a model proposal, never user permission. Existing coordinator approval, roles, Library skills, Guardian and job review remain authoritative. Dispatch rechecks the entire persisted proposal before linking a job.

Legacy project cards without the new `requireBrief` marker retain their original draft semantics; they are explicitly not proof of requirements completeness. Any recorded unknowns still block execution. Direct planner callers that explicitly supply a business brief opt into the same completeness gate. Ad hoc worker tasks remain distinct from managed project plans.

A job claiming `done` without human acceptance is `unaccepted_completion_claim`; stale accepted artifact evidence is separate. `deliveryAssessment` reports accepted steps separately from project-wide success criteria, which remain unverified. Passing these gates does not prove Laila's judgment, business feasibility, staffing accuracy or production website quality.

Completion notifications preserve the report beginning and ending, retain risks and review state, and explicitly identify truncation. Laila must inspect the full job when needed, rather than treating a completion sentence as verification.

## Cancellation, retry and OpenCode diagnostics

Direct exact control messages (stop, cancel, job cancelled) are refused as new job tasks and identify the existing Stop controls. Explicit retries follow bounded, reciprocal, same-actor retry records to recover the original goal. Missing, cyclic or mismatched lineage refuses instead of repeating a retry wrapper as the new goal.

The legacy OpenCode host/test adapter previously used a hardcoded ten-minute total timer but described it as silence. It now uses the configured total execution deadline, separately diagnoses process-output silence, clears timers/listeners and settles cancellation even if a killed child never emits close. Failure/cancellation no longer emits Finished. No model probe or paid request is introduced; neither timeout proves provider failure. The contained native production path still requires the existing approved runtime and has no host fallback.

## Static project preview and browser crash

`preview_project` captures a bounded, immutable static website snapshot from a project subfolder inside Orbit workspace. It serves only known static files through a short-lived random URL on 127.0.0.1. It refuses linked/private paths, traversal, foreign Host/Origin, directory listings and mutating HTTP methods. It does not run a build command, install packages or mount a live workspace. JavaScript modules receive the proper MIME type. Stop, replacement, shutdown and Home changes dispose the server.

The preview uses the existing browser opening/localhost human approval path. The browser now obtains its user agent from the actual Electron session, rather than creating an extra hidden BrowserWindow before the approval dialog. A real Linux Electron context probe reproduced the old crash boundary; the patched probe exits normally after a denial, and the full preview UI verifies denial, one-time approval, module rendering and Stop. A stronger displayed-frame test exposed a separate 1x1 hidden offscreen viewport in the headless runtime; explicitly applying the intended 1280x800 content size fixes it. The final test waits for module-generated colored pixels on the actual Browser canvas, rather than accepting DOM text alone. Test-only software rendering uses Electron app.disableHardwareAcceleration; production hardware settings are unchanged.

Static preview is not a framework dev server or proof that a website's backend, interactions, animations or deployment work. External assets/network requests are restricted by the preview Content Security Policy. Framework projects still need their explicitly approved build/runtime workflow.

## Usage and validation boundaries

The UI says Recorded usage and displays unavailable token cost when no usage was recorded. It does not infer free execution from zero. Native job budgets and other telemetry do not become complete aggregate billing evidence through this label change.

Tests use isolated Homes, scripted subprocesses, loopback HTTP and a real Linux Electron/Playwright process. They do not use a paid provider, production profile or Windows installer. Actual Windows reproduction, live Laila evaluation and the owner's final complete-project E2E remain acceptance work. See project-update.md for exact run counts.
