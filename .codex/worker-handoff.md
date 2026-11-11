# Parent-launched worker contract

Only main Codex launches a worker. Discover the installed CLI with Get-Command codex; inspect `codex exec --help` when upgrading. Never hardcode an old installation hash.

1. Specialist reads approved goal and original task. Create a unique request JSON under `.tmnt/runs/requests/` with requestId, role, task, phase (initial/correction), repository (absolute), specRevision, approvalEvidence, allowedFiles, dod and prompt. Exact lists and DoD must match the ledger. No credentials, CLI flags or executable paths in requests.
2. Return:
   === HANDOFF ===
   WORKER_REQUEST: <absolute JSON path>
   context: task=<id>, role=<role>, phase=<phase>
   THEN: return WORKER_RESULT to this specialist for independent verification
   === END HANDOFF ===
3. Main reads the same bytes it validates, checks actual user authorization and prompt scope (including exact allowedFiles, DoD and worker boundary), then launches from repository root:
   `node .codex/scripts/launch-worker.mjs --request <path> --cli <verified executable path>`
   This claims the request before execution, checks the task/retry state, fingerprints project files before/after and reports out-of-scope changes. It is a detector, not a per-file OS sandbox. Do not automatically revert unexpected edits. No automatic launch retry.
4. Return the full adapter result, requestId/hash, phase, exit status and evidence paths to the originating specialist. Match identity before accepting it. DONE requests verification; QUESTION is blocked; timeout/crash/missing terminator is failed. A question may follow partial edits: inspect actual changes before any redispatch.
5. Specialist independently checks DoD and reports actual changed files and results. Raphael then reviews the current state. Leonardo records outcome in original task; no stale pre-correction pass.

On Windows, request supported parent execution permission if necessary; preserve worker sandbox. Do not set HOME/CODEX_HOME, enable network globally, bypass trust or suppress approval to make startup succeed. No network override is added by this adapter. Excluded dependency/output directories must not be writable task outputs.

Ledger example (create per approved task, not a historical task):
```json
{"id":"D1","role":"donatello","specRevision":"S1","title":"bounded task","readFiles":["package.json"],"allowedFiles":["src/example.ts"],"dod":["named verification passes"],"status":"open","retryUsed":0,"lastAttempt":null,"reviewFiles":["src/example.ts","package.json"],"manualCriteria":[]}
```

Before independent checks call `beginReview(root, task, specRevision)`, then after checks call `makeReview(root, task, specRevision, checks, manual, begun)` from workflow.mjs. Any intervening file edit rejects the review. Checks require command, exitCode, passed and evidence; manual entries require criterion, status and evidence. Re-read approved goal/task and call `reviewCurrent` immediately before closure. Reproduction tasks use their explicit expected-failure criterion; never change assertions to manufacture a pass. Store reviews outside worker-owned output files. Human approval evidence remains the parent's responsibility; a JSON string alone is not user consent.

The detector compares tracked and untracked source/config files, plus Git metadata and all pre-existing run evidence. New worker log files are expected. Dependencies/build outputs are excluded, cannot be task outputs, and are not protected by this detector; permissions and independent checks remain necessary. Detection happens after execution, not as a filesystem access barrier.
