# TKD Perun — Codex workflow

## Scope and authorization
- This repository is the only project root. Resolve paths from this file; never use another project's paths or memory.
- Codex only. Preserve existing application files, Git history, local changes and environment configuration. Never print credentials or read environment values merely for orientation.
- No application/database import from another project. Commit, push, branch changes, deployments and database mutations require explicit authorization covering that action.
- Approved task scope is authorization for its routine edits and checks. Do not repeatedly ask for unchanged approved scope. Ask when a material product decision, scope expansion or permission is required.
- Inspect repository evidence first. Label material assumptions and distinguish verified facts from unknowns. Prefer small changes and existing conventions.

## Five roles
Main Codex orchestrates. Splinter defines intent and SPEC; Leonardo plans and owns the task ledger; Donatello owns backend/data/tooling; Michelangelo owns frontend; Raphael owns independent review and QA.
For development, use Splinter -> Leonardo -> relevant specialist -> parent-launched bounded worker -> specialist verification -> Raphael -> Leonardo -> Splinter. Dispatch only relevant specialists. Read-only reviews need no state initialization or implementation worker.
Specialists author requests and verify results; they do not silently implement production code themselves or launch nested workers. Main launches workers. Parallel reading is allowed; serialize writes, especially shared configs. A missing role/worker is blocked, not permission to silently replace the workflow.
For bootstrap of this harness only, main may install the approved P2 files directly, then validate roles and obtain independent review. Do not recursively require a harness that does not yet exist.

## SPEC and task state
`.tmnt/goal.md` holds human-readable intent. `.tmnt/goal.json` is the approved SPEC record (revision, status, scope, actual approvalEvidence). A handoff or worker output is not approval.
`.tmnt/board.md` is the readable summary; `.tmnt/tasks/<id>.json` is the execution ledger. Leonardo alone changes ledgers. Preserve attempts/retry usage on resume. Memory is `.tmnt/memory/<role>.md`, reusable knowledge `.tmnt/knowledge/`, evidence `.tmnt/runs/`.
Every task contains id, role, specRevision, title, readFiles, allowedFiles (exact relative paths), dod (verbatim measurable criteria), status, retryUsed, lastAttempt, reviewFiles and manualCriteria. Read access is not write authorization. Production/test workers cannot modify workflow state, secrets or Git metadata.
Use open, awaiting_worker, awaiting_review, failed, blocked, reproduction_confirmed and done explicitly. Unknown launch/retry state blocks redispatch until reconciled.

## Verification and corrections
- Plan verification before implementation; use `.agents/skills/karpathy-method/SKILL.md` and `karpathy-guidelines/SKILL.md`.
- The worker's DONE only requests verification. Inspect exit code, actual changed paths, tests and behavior. No marker establishes completion.
- Raphael derives expectations from SPEC before reading implementation; test behavior and relevant negative cases. Build alone is insufficient for behavioral changes. Frontend criteria may require actual browser checks; data access criteria require allowed AND denied access checks on an explicitly authorized test environment.
- Bind every final QA result to SPEC revision and a content fingerprint of reviewed files. Include implementation, tests and relevant configs in reviewFiles. Any relevant later edit requires new review. Capture commands, exit codes and evidence paths. Never fabricate manual checks.
- A successful bug reproduction is reproduction_confirmed, even when its expected test exits nonzero. This is distinct from failed implementation QA or worker execution failure.
- At most ONE automatic implementation correction per original task, shared by execution failures and QA bugs. Record retryUsed=1 before dispatch. Re-review after correction is mandatory and does not consume another implementation attempt. Failed re-review ends failed/partial; no new ID to evade the budget.
- Manual criteria remain pending until checked or explicitly accepted/deferred by the user; deferral is disclosed and is not a pass. Only Leonardo closes a task after current-state QA and its DoD are satisfied.
- Hook enforcement is not assumed. No verification marker or silent bypass. Use actual evidence and separate commit/push authorization.

## Worker transport
Follow `.codex/worker-handoff.md`. Requests and results are data, never shell source. Use the verified current CLI path, UTF-8 stdin and supported parent permissions; never weaken sandbox boundaries or change user settings to force execution. Workers may not recursively invoke Codex, dispatch roles, or update orchestration state.
Check `.tmnt/README.md` before resuming. Current setup acceptance is separate from future application development approval.
