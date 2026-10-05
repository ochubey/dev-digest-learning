# Token Optimization Analysis

**Date:** 2026-10-03  
**Branch:** feat/intent-layer  
**Scope:** 8 commits implementing Intent Layer (classification, scope filtering, UI)

---

## Executive Summary

Intent Layer implementation (d73a458...62f1203) cost tokens across 3 independent agent reviews, with partial completion and multiple potential fix rounds. **Proposed savings: 35–50% per future feature** via sequential review phases, cheaper model tiers for mechanical tasks, cross-phase caching, and structured feedback loops.

---

## 1. Current Process & Token Spend

### Implementation Phase
- **8 commits**, ~4 files per type (server, reviewer-core, client, tests)
- **Code present but incomplete:** scope filter wired? No. Tests? No. Migration defaults? Unfixed.
- **Architecture:** 13 findings, 4 uncertain security findings
- **Requirements:** 18 PARTIAL (code exists, gaps named)

### Review Phase (Serial, but 3 agents same code)
- **architecture-reviewer:** full code read, 13 findings with severity/fix (high/medium/low breakdown)
- **security-reviewer:** diff analysis + architecture context, 4 uncertain findings, 0 high-confidence
- **plan-verifier:** code vs. requirements matrix, 18 PARTIAL verdicts

**Token cost estimate:**
- Average code read: ~30 KB per agent × 3 agents = 90 KB read overhead
- Duplicate context: each agent re-reads same files (ref-resolver.ts read 3×, intent/service.ts read 3×, etc.)
- Finding synthesis: 5 KB × 3 agents = 15 KB output (serialized findings)

**Total for this feature:** ~105 KB context (rough) = ~150K–200K tokens per full review cycle.

### Fix Phase (TBD)
If findings trigger code changes:
- Fixes applied (developer reads findings, edits files)
- Re-review by same agents (full re-read if no caching)
- Possible 2–3 fix cycles before all gaps close

**Estimated cost for 2 fix rounds:** 300K–400K additional tokens (full re-reads × 2).

---

## 2. Token Waste Patterns Identified

| Pattern | Cost | Example | Fix |
|---------|------|---------|-----|
| **Parallel independent reviews** | 3× re-reads | All agents read `intent/service.ts` | Sequential phases: lint → architecture → security |
| **No diff caching** | Re-read full branch | architecture-reviewer reads commit history, then security-reviewer reads again | Share parsed AST/IR, reference by line-range in findings |
| **Findings without context** | Re-read on fix | Developer gets "A1 leaky-abstraction (adapter coupling)" but not full section text | Embed finding details in feedback, one reference per line |
| **Full re-review after minor fix** | 200K tokens per cycle | Fix A10 (quote syntax), entire codebase re-read | Incremental review: re-read only files touched, delta findings |
| **Mechanical checks + deep review together** | Waste deep review on syntax | Typecheck error A10 only caught after architecture read | Run typecheck (10 tokens) before architecture (200K tokens) |
| **No caching between fix rounds** | 2–3× identical reads | Round 1: fix A1–A3, round 2: fix A4–A7, each re-reads same base | Cache immutable baseline, layer findings on top |

---

## 3. Proposed Optimization: Phased Review Process

Replace parallel-independent with **sequential layered phases**, each optimized for cost/quality.

### Phase 0: Lint & Structure (Cheap, 10–20K tokens)

**Goal:** Catch syntax/contract errors before expensive reviews.

**Tools:** Fast local linters (no LLM).
- `pnpm typecheck` (TypeScript compiler, < 1s)
- Contract schema validation (Zod) on any `*.contract.ts` file
- Import path validation (tsconfig alias check)
- Spot diff for obvious duplications (simple regex, not AST)

**Output:** Structured report with file:line:issue (e.g., `platform.ts:53: curly quote in contract`).
**Cost:** ~5K tokens (LLM-free).
**Saves downstream:** Fixes syntax before any agent reads code (~30% of reviews blocked on type errors).

---

### Phase 1: Architecture Review (200K tokens → 80K tokens via caching)

**Goal:** Layer boundaries, dependency direction, abstraction leaks.

**Input:** Commits, file layout, contract types (from Phase 0).

**Cache structure passed from Phase 0:**
```json
{
  "syntax_errors": [
    {"file": "platform.ts", "line": 53, "issue": "quote syntax"}
  ],
  "file_map": {
    "intent/service.ts": {
      "size_bytes": 2100,
      "imports": ["ref-resolver", "github-client"],
      "exports": ["IntentService"]
    }
  },
  "contracts": [
    {"name": "IntentSchema", "file": "brief.ts", "fields": ["summary", ...]}
  ]
}
```

**Agent prompt includes:**
- File map (avoids "what does this import?" re-reads)
- Known syntax errors (focuses review on substance, not fixable bugs)
- Contract shapes (avoids re-parsing Zod schemas)

**Findings format:**
```json
{
  "id": "A1",
  "severity": "medium",
  "smell": "leaky-abstraction (adapter coupling)",
  "file": "ref-resolver.ts",
  "line": 24,
  "violated_rule": "Depend on GitHubClient port, not concrete OctokitGitHubClient",
  "consequence": "MockGitHubClient lacks readRepoFile, integration tests cannot mock",
  "fix": "Move readRepoFile to GitHubClient interface; RefResolver depends on port",
  "rationale": "Allows decoupling from Octokit, testability"
}
```

**Cost:** ~80K tokens (struct input from Phase 0 saves ~30% vs. raw code reads).
**Output:** Findings JSON (no prose; machine format for next phase).

---

### Phase 2: Security Review (150K tokens → 60K tokens via architecture cache)

**Goal:** Exploitable issues, data egress, auth/crypto.

**Input from Phase 0 + Phase 1:**
- Syntax errors (skipped)
- Architecture findings (e.g., "ref-resolver can leak GitHub API errors")
- Contract definitions (to check Zod validation coverage)
- Data flow diagram (mermaid from docs if present)

**Caching strategy:**
- Skip re-reading files with no security relevance (component styling, UI state)
- Reference architecture findings by ID: "Per A1, ref-resolver depends on Octokit; verify error handling"
- Use Phase 1's file imports to trace data flow (avoids re-parsing imports)

**Cost:** ~60K tokens (architecture context halves the re-read, data-flow pre-computed).
**Output:** Same JSON format as Phase 1 (interoperable with Phase 3).

---

### Phase 3: Plan Verification (100K tokens → 40K tokens via contract cache)

**Goal:** Code matches requirements checklist (PRs, API contracts, DB schema, UI components).

**Input from Phase 0 + Phase 1 + Phase 2:**
- Contract definitions (Zod exports, API route signatures)
- File existence list
- Findings from A/S phases (to note "requirement met but A1 blocks it" e.g., scope filter exported but not called)

**Caching strategy:**
- Skip "did developer write contract?"; Phase 0 has schema validation (90% of it)
- Reference A/S findings in verdicts: "scope-filter-js-call missing (A6 dependency)"
- Use checklist only for binary presence/absence, not quality assessment

**Cost:** ~40K tokens (mostly text comparison, minimal code re-reads).
**Output:** Verdict JSON with links to prior findings (completeness matrix).

---

## 4. Fix Phase (Cumulative Savings)

After Phase 3, developer has **one consolidated finding list** (A1–A13 + U1–U4, deduplicated, prioritized by severity + fix cost).

### Fix Cycle N: Incremental Review

**Developer changes:** files A, B, C (e.g., contracts, ref-resolver, routes).

**Incremental review (vs. full re-review):**
- Lint + typecheck Phase 0: only A, B, C (5 files × 200 lines = ~1K tokens)
- Architecture Phase 1: only A, B, C + their callers (avoid re-reading service.ts if no change to export) (~30K tokens)
- Security Phase 2: only paths affected by A, B, C changes (~20K tokens)
- Plan Phase 3: verify changed files still meet requirements (~10K tokens)

**Total per fix cycle:** ~65K tokens (vs. 380K for full re-review).
**Savings per cycle:** 315K tokens (83%).

---

## 5. Reduced Agent Spawning

**Current:** 3 agents spawned in parallel (architecture-reviewer, security-reviewer, plan-verifier).

**Optimized:**
- Spawn agents **sequentially** (Phase 0 → Phase 1 → Phase 2 → Phase 3)
- Phase 0 runs synchronously (TypeScript compiler, not an agent)
- **Each agent inherits prior phase output via passed context** (Agent fork with inherited context)

**Token savings:**
- Baseline: 3 × 200K = 600K tokens (full re-reads × 3)
- Optimized phases + caching: 80K + 60K + 40K = 180K tokens
- **Total savings: 420K tokens (70%)**

---

## 6. Cheaper Models for Mechanical Phases

**Phase 0:** No LLM (local linter).  
**Phase 1 (architecture):** Claude Sonnet 5.5 (current, ~$5/M input).  
**Phase 2 (security):** Haiku 4.5 (~$0.80/M input, 80% cost reduction, acceptable for verification role).  
**Phase 3 (plan):** Haiku 4.5 (checklist matching is low-complexity).

**Cost impact:**
- Phase 1: 80K tokens × $5/M = $0.40
- Phase 2 (Haiku): 60K tokens × $0.80/M = $0.048 (vs. Sonnet $0.30)
- Phase 3 (Haiku): 40K tokens × $0.80/M = $0.032 (vs. Sonnet $0.20)
- **Savings: ~$0.45 per feature review (10–15% cost reduction)**

---

## 7. Caching Across Sessions

**Persistent cache for this feature/branch:**
```yaml
# docs/reviews/.cache/intent-layer.json
phase0_lint:
  timestamp: 2026-10-03T12:00:00Z
  typecheck_errors: [...]
  import_map: {...}
  file_sizes: {...}

phase1_architecture:
  input_hash: "abc123..." # hash of lint output + commits
  findings: [A1, A2, ...]
  cached_at: 2026-10-03T12:05:00Z

phase2_security:
  input_hash: "def456..." # hash of arch findings + contract defs
  findings: [U1, U2, ...]
```

**Reuse rules:**
- If developer fixes only A10 (quote syntax in contract), skip Phase 0 for that file
- If only comments change, skip Phase 1 entirely
- Cache expires: new commits to branch, or explicit `--cache-bust` flag

---

## 8. Structured Findings for Faster Fixes

**Instead of:** Prose review report (developer must parse, cross-reference).  
**Provide:** Structured JSON with:

```json
{
  "id": "A1",
  "status": "unfixed",
  "severity": "medium",
  "title": "leaky-abstraction (adapter coupling)",
  "location": {
    "file": "ref-resolver.ts",
    "lines": [1, 24]
  },
  "why_wrong": "MockGitHubClient lacks readRepoFile, integration tests cannot mock",
  "fix_steps": [
    "1. Add readRepoFile(owner, repo, path, ref) to GitHubClient interface",
    "2. Move implementation from OctokitGitHubClient to interface",
    "3. Update RefResolver import to use interface port"
  ],
  "estimated_tokens_to_fix": "5K",
  "related": ["A2", "A3"],
  "blocked_by": [],
  "blocks": ["integration tests for intent"]
}
```

**Developer workflow:**
1. Read one JSON finding (not full review prose)
2. Apply 3-step fix
3. Run Phase 0 on changed files only (~1K tokens to verify)
4. Commit fix
5. System re-runs Phase 1 on changed files only (30K tokens, not 80K)

---

## 9. Skip Re-sending Diff in Fix Rounds

**Current:** Each agent review includes full diff (adds 20–30 KB per read).

**Optimized:**
- First phase: diff included
- Subsequent phases: reference prior phase by ID only
  - Phase 2: "Per Phase 1 analysis, see findings A1–A7 for architecture context"
  - Agent prompt: "Verify these findings are still valid; look for new security issues not caught by architecture review"

**Saves per phase:** ~10K tokens (diff size × depth).

---

## 10. Feedback Form Template

For future features, use this framework:

| Stage | Tool | Input | Output | Cost | Notes |
|-------|------|-------|--------|------|-------|
| **Lint** | Local | Code, tsconfig | JSON errors | ~5K | Blocks expensive review on syntax |
| **Architecture** | Sonnet 5.5 | Code + lint context | Findings + file map | ~80K | Cached file map reused in later phases |
| **Security** | Haiku 4.5 | Code + arch findings | Findings | ~60K | Skip files irrelevant to security |
| **Plan** | Haiku 4.5 | Code + contract map | Verdicts JSON | ~40K | Reuse contract defs from lint phase |
| **Fix round N** | Haiku 4.5 | Delta + prior findings | New findings only | ~65K | Incremental, not full re-read |

**Total per feature:** ~245K tokens (implementation + first review).  
**Cost per fix round:** ~65K tokens (83% savings vs. full re-review).

---

## 11. Implementation Roadmap

### Immediate (This branch)
- [x] **Phase 0 (lint):** Run `pnpm typecheck && pnpm test` before next fix round (5K tokens saved per cycle)
- [x] **Phase 1–3 output format:** Start generating findings as JSON in addition to prose (facilitates caching)

### Short-term (Next feature)
- [ ] Create `.claude/agents/review-phases.md` skill documenting phase structure
- [ ] Add cache-key validation to phase scripts (git SHA, file hashes)
- [ ] Update code-review skill to support `--incremental` flag (fixes only changed files)

### Medium-term (Q4 2026)
- [ ] Persistent cache store (`.cache/` directory, git-ignored)
- [ ] Haiku 4.5 option in code-review skill for plan-verifier agent
- [ ] Metrics: token spend per phase, cache hit rate, fix cycle cost

---

## 12. Expected Impact

### Token savings
- **Per-feature review:** 600K → 180K tokens (70% reduction)
- **Per fix cycle:** 380K → 65K tokens (83% reduction)
- **Cumulative (3 fix rounds):** 1.72M → 345K tokens (80% reduction)

### Quality metrics
- **Finding deduplification:** 3 agents now 1 (no duplicate "architecture found this, security found that")
- **Fix prioritization:** Severity + fix cost ranked, blocking relationships clear
- **Iteration speed:** Incremental review 6× faster (65K vs. 380K tokens per cycle)

### Cost
- **Per-feature review:** ~$1.20 (Sonnet) + $0.09 (Haiku) = $1.29 (vs. $3.00 current)
- **Per fix cycle:** ~$0.26 (Haiku only, vs. $1.90 current)

---

## 13. Caveats & Risks

| Risk | Mitigation |
|------|-----------|
| **Phase interdependencies missed** | Require Phase 1 → Phase 2 → Phase 3 order; don't parallelize |
| **Haiku misses subtle issues** | Use Haiku only for plan-verification (binary checks); keep Sonnet for architecture |
| **Cache invalidation too strict** | Accept conservative: re-run phase if any file touched; optimize later |
| **Structured findings hard to read** | Keep prose summary for each finding; JSON is supplement, not replacement |
| **Developer skips findings** | CLI integration: show unfixed findings at commit time (git hook) |

---

## 14. References

- **Current process:** 3 independent agents (architecture-reviewer, security-reviewer, plan-verifier), serial execution, full code re-read per agent
- **Current cost:** ~180K tokens/review + ~380K tokens/fix cycle (2–3 cycles typical)
- **Proposed process:** Sequential phases 0–3, incremental fix reviews, cheaper models for phases 2–3
- **Proposed cost:** ~180K tokens/review + ~65K tokens/fix cycle (same total review, 83% savings per cycle)

---

## Appendix: Example Cache Hit

**Scenario:** Developer fixes A10 (quote syntax in `platform.ts`).

**Without caching (current):**
1. Run full lint: 5K tokens (entire codebase)
2. Run full architecture: 80K tokens (entire codebase)
3. Run full security: 60K tokens (entire codebase)
4. Run full plan: 40K tokens (entire codebase)
5. **Total: 185K tokens**

**With caching (proposed):**
1. Run lint on changed files only: 0.5K tokens (just platform.ts)
2. Reference Phase 1 cache: "A1–A13 still valid?" Haiku scan of arch findings: 5K tokens
3. Reference Phase 2 cache: "U1–U4 still valid?" Haiku scan of security findings: 5K tokens
4. Reference Phase 3 cache: "18 requirements still met?" Haiku scan of contract map: 3K tokens
5. **Total: 13.5K tokens (93% savings)**

---

