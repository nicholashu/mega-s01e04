---
name: plan-to-issues
description: Split this repo's plan.md into GitHub issues with gh, one per unit of work, after a human has reviewed the split. Use when a plan is ready and has no issues yet.
---

# plan-to-issues

Turns `plan.md` into GitHub issues that workers can pick up cold. Easiest with `gh`, authenticated,
in a shell this agent can run.

## Steps

1. Read `plan.md`, `AGENTS.md` and `docs/adr/`.
2. Draft the split as a table: title · plan section · scope · done when · blocked by · closure evidence.
   One issue per unit of work. When later work needs an outside response, apply ADR 0002's
   wait and cleanup dependencies. Include that wait in the split the human reviews.
3. **Stop and show the table to the human.** Publish nothing until they approve it.
4. Ask the human what every issue here must carry (fields, labels, wording), unless it is
   already written down in this session or in the repo.
5. Create each issue in dependency order, so blocked-by can cite real numbers:

   ```sh
   gh issue create --title "<title>" --body-file <tmp.md>
   ```

6. Record every issue URL from gh's output (not from memory) and reply with the list.

## Issue body

Use the fields required by ADR 0002:

```md
Source: plan.md § <n>

## Scope
<unit of work>

## Done when
<observable acceptance condition>

## Blocked by
<issue links, or none>

## Completion evidence
<required evidence; record the actual result here before closing>
```

For an issue awaiting an outside response, its scope also names who or what it awaits,
the required confirmation, and the callback or next-check method.

## Closing an issue

Record evidence that meets its done condition and check that blocking issues are resolved.
For an outside wait, record the required confirmation first. Then use the closing comment
from AGENTS.md:

```sh
gh issue close <n> -c "<closing comment>"
```

## No `gh`

Steps 1–4 hold either way. GitHub reachable another way (a connector, the REST API, the web UI):
the same issues, made that way. GitHub issues out of reach altogether: write them as files in
`docs/issues/`, format in ADR 0004, then commit and push.

## Don'ts

- Don't paste the whole plan into one issue, and don't keep issues only in chat.
- Don't invent sections the plan doesn't have. If the plan is unclear, ask.
