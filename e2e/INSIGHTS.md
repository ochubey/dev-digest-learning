# Insights

## What Works

## What Doesn't Work

## Codebase Patterns

## Tool & Library Notes

- The flow DSL has no "assert element/text absent" primitive — only positive assertions (`wait --text`, `wait --url`, `find role|text|label`). Absence can only be proven indirectly (e.g. toggling a filter off and re-asserting the previously-hidden text reappears), not directly. `e2e/README.md:32`. (2026-09-27)

## Recurring Errors & Fixes

## Session Notes

## Open Questions
