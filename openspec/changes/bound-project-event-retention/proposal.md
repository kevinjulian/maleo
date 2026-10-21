## Why

`content_project_events` has the same unbounded shape `bound-storyboard-retention`
fixed for storyboards: rows are written at the rate the agent works and nothing
removes one. Measured on the working database (2026-09-26):

```
content_project_events   403,977 rows   ~148 MB table (81 MB payload + summary text)
  storyboard.created      229,594   one per storyboard write
  agent.tool_call          37,635
  agent.asset              32,177
  agent.session_started    28,892
  agent.session_ended      28,560
  agent.pipeline_checkpoint 10,268   37 MB payload, the heaviest per row
```

It is 1/50th the size storyboards were, so it is not urgent, but it grows without
limit on the same path. `storyboard.created` events also now name storyboard ids
that retention has pruned; they stay readable as audit text but no longer resolve.

## What Changes

- Decide which project events carry lasting meaning (project, reference and
  output lifecycle, approvals) and which are step-level agent telemetry.
- Bound step-level events per project, enforced on write like storyboard
  retention, with a stated window.
- Provide a dry-run-by-default reclaim for existing rows.

## Capabilities

### New Capabilities

- `project-event-retention`: which project events are kept, which are discarded,
  and when pruning happens.

### Modified Capabilities

## Impact

- `packages/db/src/db/events.ts` — the write path gains a prune step.
- Readers of the event feed (project detail reads the newest 200 by default).
- A one-time reclaim script.
