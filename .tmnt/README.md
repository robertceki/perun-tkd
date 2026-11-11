# Fresh TKD workflow state

This state starts with approved setup P2 only. No previous AI memory or application goal is imported.
Read goal.md/goal.json, board.md and the original task ledger before resuming.
Runs and request claims are immutable evidence; unknown launch state must be reconciled, never replayed.
Use memory/<role>.md for concise durable notes, knowledge/ for accepted decisions. Do not store secrets or transcript dumps.
Validate the harness with `node --test .codex/scripts/workflow.test.mjs` and `node .codex/scripts/run-worker.test.mjs` (tests write isolated fixtures under .tmnt/runs).
Application development requires its own SPEC. Existing src, package files and environment settings are preserved by P2.
