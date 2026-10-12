import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../src/modules/evals');
const FORBIDDEN = [
  /reviewer-core\/src\/llm/,
  /adapters\/llm/,
  /^@devdigest\/reviewer-core/,
  /^openai(\/|$)/,
  /^@anthropic-ai\/sdk/,
];

interface Import {
  spec: string;
  typeOnly: boolean;
}

function importsOf(source: string): Import[] {
  const out: Import[] = [];
  const re = /(?:^|\n)\s*(import|export)\s+(type\s+)?([^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g;
  for (const m of source.matchAll(re)) out.push({ spec: m[4]!, typeOnly: Boolean(m[2]) });
  const dyn = /import\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const m of source.matchAll(dyn)) out.push({ spec: m[1]!, typeOnly: false });
  const req = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const m of source.matchAll(req)) out.push({ spec: m[1]!, typeOnly: false });
  return out;
}

function walk(entry: string): { file: string; imports: Import[] }[] {
  const seen = new Set<string>();
  const result: { file: string; imports: Import[] }[] = [];
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    const imports = importsOf(readFileSync(file, 'utf8'));
    result.push({ file, imports });
    for (const i of imports) {
      if (!i.spec.startsWith('.')) continue;
      visit(path.resolve(path.dirname(file), i.spec.replace(/\.js$/, '.ts')));
    }
  };
  visit(entry);
  return result;
}

describe('eval scoring purity', () => {
  it('import graph of scoring.ts (recursive, relative) contains no reviewer-core/src/llm, adapters/llm, @devdigest/reviewer-core barrel, openai, @anthropic-ai/sdk; only type imports from @devdigest/shared', () => {
    const graph = walk(path.join(ROOT, 'scoring.ts'));
    expect(graph.map((g) => path.basename(g.file))).toContain('matching.ts');
    for (const { file, imports } of graph) {
      for (const i of imports) {
        for (const bad of FORBIDDEN) {
          expect(i.spec, `${path.basename(file)} imports ${i.spec}`).not.toMatch(bad);
        }
        if (i.spec.startsWith('@devdigest/shared')) {
          expect(i.typeOnly, `${path.basename(file)} must use import type for ${i.spec}`).toBe(true);
        }
        if (!i.spec.startsWith('.') && !i.spec.startsWith('@devdigest/shared')) {
          throw new Error(`${path.basename(file)} has non-relative import ${i.spec}`);
        }
      }
    }
  });
});
