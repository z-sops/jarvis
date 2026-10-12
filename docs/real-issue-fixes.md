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

## Planning behavior follow-up

Owner's live screenshots showed only a generic requirements/design/code/test outline, premature additional-worker suggestions and no actual requirement questions. That is not a planning acceptance pass. The installed build revision was not established by the screenshot. Titles are secondary; this increment does not rename the assistant or substitute a framework.

The common voice/text commander prompt now gives project planning explicit priority over casual spoken brevity and immediate single-worker delegation. It requires actual questions in the current reply, separates known facts from assumptions, reuses existing workers, records a structured blocked proposal and returns to that same proposal. A planning-only request cannot become execution approval. Titles do not determine capability or authority.

The existing list_agents response now supplies actual assigned Library skill metadata, legacy skill filenames, readiness and sampled job evidence. The planner reuses this observation in staffingEvidence, once per recommended worker per inspection. Human-accepted files and report-only work remain distinct; recorded tests are not freshly verified tests. Role/skill metadata is reference data and grants no permissions. Missing records mean unknown capability, not proof of inability. Skill output is bounded to20 entries/400-character descriptions, legacy20 filenames, and job sampling to50 records with a200-record inventory/2MiB-record preflight. Large, linked, corrupt or unavailable observations are explicit unknown/partial, never silently zero or proficient. No capability score or new worker is invented.

get_project_plan.nextPlanningAction surfaces the existing unanswered business details and whether measurable acceptance is missing. The authoritative project card and existing readiness/dispatch/approval/QA controls are retained.

Offline tests verify observations, corruption/bound refusal and actual Electron voice-context/tool declaration plus planning-only draft persistence and blocked dispatch. They do not run a live model or prove that Laila asks the right questions, proposes accurate staffing or makes correct business decisions. Rebuild/restart the Windows app and reconnect voice before repeating the original project prompt; an existing live connection holds its start-time system prompt. Assess the actual new model response before accepting planning behavior.

## Revising the actual draft after clarification

Owner's continued live response reported missing design/requirements roles and empty outputs/dependencies. This was an assistant summary, not a raw saved-card inspection. Source investigation found a concrete transition gap: refine_project_brief could update only business text, leaving original steps/roles/assignments unchanged. It now accepts an optional refined full goal, replacement steps using the same plan_project schema, and files/report delivery type. It preserves the project ID and original goal, validates bounded fields/output paths/DAG/hierarchy, changes briefRevision when delivery contract changes, and still refuses any dispatched/coordinator-approved or incomplete-staffing scope. No jobs, workers, permissions or artifacts are created by refinement.

New tool-created drafts require a declared delivery type before execution. A files proposal without any concrete expected output path remains blocked. Legacy unspecified cards stay explicitly unverified and can be refined with an explicit contract; their state is not silently migrated. This syntactic/contract gate cannot prove that an LLM correctly classified a project or that listed outputs cover every requirement. Dependencies remain explicitly declared, not universally invented by the host.

Step-ID descriptions and invalid-field errors now state the exact supported lowercase/digit/hyphen format with examples. Invalid IDs are never silently normalized/remapped. Stored expectedOutputs must be translated to proposed expected_outputs; accidental copying gets actionable feedback.

Typed commander turns now explicitly request detailed text, actual step/worker/path/criterion/blocker tables or lists and text-appropriate style/emotion. Voice keeps its spoken summary with the same planning tools/controls. Mic muted is still a connected voice session; End voice is required to route typed messages through the text path. No live model accuracy or complete website acceptance follows from these code changes.
