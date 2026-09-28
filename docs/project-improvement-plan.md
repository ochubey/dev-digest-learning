# DevDigest — improvement plan (full-stack audit)

Sources applied: `ui-architecture` skill, `react-best-practices` skill, `next-best-practices` skill
(client); `docs/onion-architecture-skill-plan.md` rules applied manually, not yet a real skill (server).
Read-only audit — no fixes applied.

## CRITICAL

None found that block correctness/security. Highest-severity items below are "worth fixing."

## Worth fixing

### Server — onion-architecture plan (no service layer at all)

1. **`server/src/modules/pulls/routes.ts`** (~13 sites: lines 28,47,80,97,125,151,179,243,250,263,265,275,277,287,302,303,340,345)
   - Rule: routes.ts must not do data access directly — must call service.ts (plan §3 rule 1)
   - Route file does full CRUD (select/insert/delete) itself — no `service.ts`/`repository.ts` exists for this module. Worst violation in repo.
   - Fix: add `modules/pulls/service.ts` + `repository.ts`, move all `container.db` calls there, routes call service only.

2. **`server/src/modules/settings/routes.ts:30,53,61`** — same pattern, no `service.ts`. Fix: same as above.

3. **`server/src/modules/workspace/routes.ts:18`** — same pattern, no `service.ts`. Fix: same as above.

4. **`server/src/modules/polling/routes.ts:22,32,60`** — same pattern, no `service.ts`. Fix: same as above.

5. **Structural gap — no `domain/` layer in any of 8 feature modules** (`agents, polling, pulls, repo-intel, repos, reviews, settings, workspace`)
   - Rule: plan §5 (domain dir per module)
   - Not urgent per-line; blocks enforcing layer-direction rule since nothing to separate yet.
   - Fix: when tackled, start with `pulls` and `repo-intel` (largest services).

6. **`server/src/modules/repo-intel/service.ts:22,28`, `server/src/modules/reviews/diff-loader.ts:3`** import parsing helpers from `adapters/codeindex/extract.js`, `adapters/astgrep/index.js`, `adapters/git/diff-parser.js`
   - Rule: plan §3 — `adapters/*` imported only from `platform/container.ts` (composition root)
   - These are pure stateless parsing functions, not I/O ports, so not a real DI violation — but living under `adapters/` makes them read as forbidden by the letter of the rule.
   - Fix: either relocate to `_shared/` or module-local `lib/`, or carve an explicit plan exception for stateless parsing helpers vs I/O-port adapters. (Decide when the skill is actually authored.)

### Client — React patterns

7. **`client/src/app/agents/[id]/_components/AgentEditor/_components/ConfigTab/ConfigTab.tsx:18-39`**
   - Rule: react-best-practices — never `useState`+`useEffect` to sync a computed/prop value ("Derive Don't Store")
   - 9 `useState` fields reset via a `useEffect` keyed only on `agent.id`, with `eslint-disable` hiding real exhaustive-deps issues.
   - Fix: `<ConfigTab key={agent.id} agent={agent} />` at call site — remount instead of effect-reset.

8. **`client/src/app/repos/[repoId]/pulls/[number]/_components/FindingsPanel/FindingsPanel.tsx:44-46`**
   - Rule: react-best-practices — no `useEffect` for parent notification of a derived value
   - `useEffect(() => onVisibleCountChange?.(shown.length), [shown.length, onVisibleCountChange])`
   - Fix: call `onVisibleCountChange?.(shown.length)` directly at the point `shown` is computed, not in an effect.

## Optional

9. **`client/src/components/showcase/Showcase.tsx`** (259 lines) — react-best-practices 200-line component guideline. Dev-only static gallery page, zero business logic — low risk. Fix (if touched anyway): split `<Group>` blocks into `_sections/`.

10. **App-wide inline `style={{...}}` alongside Tailwind `className`** (21 files, e.g. `pulls/[number]/page.tsx:101,136`) — ui-architecture constants-promotion rule. `vendor/ui/**` itself is intentionally style-object-based (design system, read-only per CLAUDE.md) — not a violation there. App-level duplicated layout objects (`maxWidth: 1080, padding: "24px 32px"` repeated across page files) could be promoted to a shared style constant.

11. **Whole client app forgoes Next.js 15 RSC data-fetching, uses TanStack Query client-side everywhere** — next-best-practices notes RSC could remove first-paint loading waterfalls. Architecture choice, not a defect — flagging only as a possible future win, not a rule violation.

12. **No `dependency-cruiser` config enforcing onion-architecture import rules today** — `dependency-cruiser` is already a repo dependency (used inside `adapters/depgraph`) but has no project-level ruleset. Natural mechanism to enforce plan §3 once the domain split lands — decide at skill-authoring time.

## Clean — no violations found

- Client: routing purity (`app/**` has no inline business logic), colocated-vs-shared component boundaries, naming conventions (100% compliant), constants placement, utils-vs-hook separation, test colocation, no Client Component importing DB/secrets/node builtins, no unstable-key or stale-closure bugs.
- Server: no concrete adapter class ever imported into `modules/**` or leaked into a `service.ts` function signature (port-interface rule is fully respected); `container.<x>` getter pattern used consistently, no bare `new Adapter()` outside `container.ts`.
