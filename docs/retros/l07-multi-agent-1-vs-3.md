# L07: one agent vs three agents on the same PR

Measured on 2026-10-17 on `ochubey/devdigest-demo` PR #2 (`feat: add reporting database helpers`, +24 lines, one file `src/db.js` with a planted secret, a Stripe key and a SQL injection). All agents use `deepseek/deepseek-v4-flash` through OpenRouter, single-pass. Wall-clock is measured from the `POST /pulls/:id/review` request until every run left `running`. Tokens, cost, durations and findings come from `agent_runs`; groups and conflicts from `GET /multi-agent-runs/:id`. One run each, sequentially (not at the same time).

## Results

| | 1 agent (Security) | 3 agents (Security + API Contract + General) | Ratio 3 / 1 |
|---|---|---|---|
| Wall-clock | 28.8 s | 34.9 s | 1.21x |
| Tokens in | 3 561 | 18 278 | 5.13x |
| Tokens out | 2 699 | 9 626 | 3.57x |
| Cost | $0.00019 | $0.00075 | 3.9x |
| Findings (raw) | 2 | 11 | 5.5x |
| Finding groups | - | 5 (2 of them conflicts) | - |

Per agent in the 3-agent run:

| Agent | Duration | Tokens in -> out | Cost | Findings |
|---|---|---|---|---|
| API Contract Reviewer | 30.6 s | 6 598 -> 2 860 | $0.00026 | 3 |
| General Reviewer | 34.3 s | 3 436 -> 3 461 | $0.00022 | 5 |
| Security Reviewer | 33.3 s | 8 244 -> 3 305 | $0.00026 | 3 |

## What the numbers say (and do not say)

- Cost and tokens grew roughly with the number of agents (3.9x cost for 3x agents), wall-clock only 1.2x because the agents run in parallel. The 3.9x is above 3x; it is not an expected-3x result that was fitted.
- The same Security Reviewer used 3 561 input tokens alone and 8 244 inside the multi-agent run, and reported 2 findings alone versus 3 inside it. This was not investigated: it may be model variance, a different project-context or skills payload, or retries. With one run per setup the ratio is indicative, not a benchmark.
- Shared work (diff load, intent) is done once per multi-agent run, which this table does not isolate. Cache hits and differing answer lengths also move the ratio.
- 11 raw findings collapsed into 5 groups; three of them (hardcoded password, Stripe key, SQL injection) were flagged by all three agents, the other two by a single agent each (conflicts).
- Run costs are tiny ($0.0002 to $0.0003 per agent); the ratio matters more than the absolute value.
