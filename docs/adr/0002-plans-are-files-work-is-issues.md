# 0002 · Plans are files, work is issues

- Status: accepted · 2026-10-13 · amended by 0004 (issues as files when GitHub's can't be reached)

## Context

Plans written into chat vanish with the session. Plans written into one big issue get worked
top to bottom by a single agent, including the parts that should have waited.

## Decision

- A plan is a file, `plan.md` at the root, reviewed like code. Finished plans move to
  `docs/plans/done/` with their issue list.
- Work happens in GitHub issues split from the plan (skill `plan-to-issues`), one per unit of
  work, each with its source section, scope, a checkable done condition, what it's blocked by,
  and the evidence required to close it. Record the actual evidence before closing.
- If later work needs an outside response, track that wait in its own issue: who or what it
  awaits, the confirmation required, and the callback or next-check method. Keep it open until
  confirmation is recorded, with dependent cleanup blocked by it. Sending the request can
  complete a separate delivery issue. Add a wait only when the requested outcome needs it.
- Issues are worked by workers, one issue each. The closing comment records which model did it
  (format in AGENTS.md), so we can see later which models are worth their cost per kind of task.

## Consequences

- Anyone, human or agent, picks up a plan cold from the repo alone.
- The split is the plan's real review. A bad split is a bad plan.
