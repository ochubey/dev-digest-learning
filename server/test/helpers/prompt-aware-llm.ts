import type { EvalExpectation } from '@devdigest/shared';
import { RecordingLLM, type RecordedCall, type ScriptedFinding } from './recording-llm.js';

/** Markers a test appends to a system prompt to pick the fake's behaviour. No marker = GOOD. */
export const BROKEN_MARKER = '[[FAKE:BROKEN]]';
export const SILENT_MARKER = '[[FAKE:SILENT]]';

export type PromptBehaviour = 'GOOD' | 'BROKEN' | 'SILENT';

export function behaviourOf(systemPrompt: string): PromptBehaviour {
  if (systemPrompt.includes(BROKEN_MARKER)) return 'BROKEN';
  if (systemPrompt.includes(SILENT_MARKER)) return 'SILENT';
  return 'GOOD';
}

interface DiffLines {
  file: string;
  added: number[];
}

/** Reads the unified diff out of the user message (new-side numbers of the added lines, per file). */
function addedLines(userMessage: string): DiffLines[] {
  const out: DiffLines[] = [];
  let cur: DiffLines | null = null;
  let n = 0;
  for (const line of userMessage.split('\n')) {
    const plus = line.match(/^\+\+\+ b\/(.+)$/);
    if (plus) {
      cur = { file: plus[1]!, added: [] };
      out.push(cur);
      continue;
    }
    const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)/);
    if (hunk) {
      n = Number(hunk[1]);
      continue;
    }
    if (!cur || line.startsWith('---') || line.startsWith('diff --git')) continue;
    if (line.startsWith('+')) cur.added.push(n++);
    else if (line.startsWith(' ')) n++;
  }
  return out;
}

const finding = (file: string, line: number): ScriptedFinding => ({
  file,
  start_line: line,
  end_line: line,
  severity: 'WARNING',
  category: 'security',
  title: `Possible issue at ${file}:${line}`,
});

/**
 * Deterministic stand-in for a model whose output depends on the system prompt:
 * - GOOD: one finding on every `must_find` range that touches an added line of the diff it sees;
 * - BROKEN: one finding on every added line, including the `must_not_flag` zones;
 * - SILENT: no findings.
 * `expectations` is the answer key; it is never sent anywhere (the fake only reads the messages).
 */
export function promptAwareLLM(expectations: ReadonlyArray<EvalExpectation>): RecordingLLM {
  return new RecordingLLM({
    findings: (call: RecordedCall): ScriptedFinding[] => {
      const system = call.messages.find((m) => m.role === 'system')?.content ?? '';
      const user = call.messages.find((m) => m.role === 'user')?.content ?? '';
      const behaviour = behaviourOf(system);
      if (behaviour === 'SILENT') return [];
      const files = addedLines(user);
      if (behaviour === 'BROKEN') return files.flatMap((f) => f.added.map((n) => finding(f.file, n)));
      return expectations
        .filter((e) => e.kind === 'must_find')
        .flatMap((e) => {
          const hit = files.find((f) => f.file === e.file)?.added.find((n) => n >= e.start_line && n <= e.end_line);
          return hit === undefined ? [] : [{ ...finding(e.file, hit), start_line: e.start_line, end_line: e.end_line }];
        });
    },
  });
}
