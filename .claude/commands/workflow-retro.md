---
description: Manual retrospective of a finished multi-agent workflow run (tokens, agents, handoffs, proposals)
argument-hint: [deep]
disable-model-invocation: true
---

# workflow-retro

Run only when the user invokes it. Never trigger automatically.

Mode: `$ARGUMENTS` (empty = from context; `deep` = read session logs under `~/.claude/projects/<project>/` including subagent logs, because the parent usage may omit child cost).

## Collect
- Tokens: input, output, cache read per agent and total; tool calls; wall time; peak parallelism
- Agents launched and their order
- Per agent: what was hard, what was easy, context loaded twice, what was missed, bad handoffs

## Output
1. Short summary in chat: table of agents x tokens/tool calls/time, then findings.
2. Concrete proposals (each actionable): remove duplicated context, preload a shared file, split an overloaded role, lower concurrency, move a role to a cheaper model.
3. Append one entry (date, feature, totals, top 3 proposals) to `docs/retros/ledger.md`. Module-specific insights go to the relevant `INSIGHTS.md` only after the user agrees.

Do not invent numbers: if a figure is unavailable in context, say so and suggest `deep`.
