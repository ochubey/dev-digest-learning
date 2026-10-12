import type {
  ChatMessage,
  CompletionRequest,
  CompletionResult,
  Finding,
  LLMProvider,
  ModelInfo,
  StructuredRequest,
  StructuredResult,
} from '@devdigest/shared';

/** One scripted finding; unspecified fields get neutral defaults. */
export type ScriptedFinding = Partial<Finding> & Pick<Finding, 'file' | 'start_line' | 'end_line'>;

/** What a scripted call yields: findings, or a thrown error. */
export interface RecordedCall {
  index: number;
  model: string;
  schemaName: string;
  /** Deep copy of the messages at call time. */
  messages: ChatMessage[];
  /** Keys of the request, to assert no tools / extras are passed. */
  requestKeys: string[];
}

export interface RecordingLLMOptions {
  id?: LLMProvider['id'];
  /** Findings returned per call (default: none). */
  findings?: (call: RecordedCall) => ScriptedFinding[];
  /** Throw this error for the call (checked before `findings`). */
  throwFor?: (call: RecordedCall) => Error | undefined;
  /** Resolve after this many ms (real timers). */
  delayMs?: number | ((call: RecordedCall) => number);
  /** Resolve only once this promise settles (manual gate). */
  gate?: Promise<unknown>;
  /** Never resolve (for timeout tests). */
  hang?: (call: RecordedCall) => boolean;
  tokensIn?: number;
  tokensOut?: number;
  /** `null` simulates an unpriced model. */
  costUsd?: number | null;
}

function toFinding(f: ScriptedFinding, i: number): Finding {
  return {
    id: `f-${i}`,
    severity: 'WARNING',
    category: 'bug',
    title: `Finding ${i}`,
    rationale: 'because',
    confidence: 0.9,
    ...f,
  } as Finding;
}

/**
 * LLMProvider test double for the eval runner. Records every request (messages are
 * deep-copied), tracks the number of concurrent calls, and supports scripted findings,
 * delays, a manual gate, hangs and per-call errors.
 */
export class RecordingLLM implements LLMProvider {
  readonly id: LLMProvider['id'];
  calls: RecordedCall[] = [];
  /** Calls to anything other than completeStructured (a stateless review makes none). */
  otherCalls: string[] = [];
  inFlight = 0;
  maxInFlight = 0;

  constructor(private opts: RecordingLLMOptions = {}) {
    this.id = opts.id ?? 'openrouter';
  }

  async listModels(): Promise<ModelInfo[]> {
    this.otherCalls.push('listModels');
    return [];
  }

  async complete(_req: CompletionRequest): Promise<CompletionResult> {
    this.otherCalls.push('complete');
    throw new Error('RecordingLLM.complete is not scripted');
  }

  async embed(_texts: string[]): Promise<number[][]> {
    this.otherCalls.push('embed');
    return [];
  }

  async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    const call: RecordedCall = {
      index: this.calls.length,
      model: req.model,
      schemaName: req.schemaName,
      messages: JSON.parse(JSON.stringify(req.messages)) as ChatMessage[],
      requestKeys: Object.keys(req).sort(),
    };
    this.calls.push(call);
    this.inFlight++;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    try {
      if (this.opts.hang?.(call)) await new Promise<never>(() => {});
      const delay = typeof this.opts.delayMs === 'function' ? this.opts.delayMs(call) : this.opts.delayMs;
      if (delay) await new Promise((r) => setTimeout(r, delay));
      if (this.opts.gate) await this.opts.gate;
      const err = this.opts.throwFor?.(call);
      if (err) throw err;
      const findings = (this.opts.findings?.(call) ?? []).map(toFinding);
      const data = { verdict: 'comment', summary: 'scripted', score: 90, findings };
      const parsed = (req.schema as { parse: (x: unknown) => T }).parse(data);
      return {
        data: parsed,
        model: req.model,
        tokensIn: this.opts.tokensIn ?? 100,
        tokensOut: this.opts.tokensOut ?? 20,
        costUsd: this.opts.costUsd === undefined ? 0.001 : this.opts.costUsd,
        raw: JSON.stringify(data),
        attempts: 1,
      };
    } finally {
      this.inFlight--;
    }
  }

  /** The user-message content of every call, in call order. */
  userMessages(): string[] {
    return this.calls.map((c) => c.messages.find((m) => m.role === 'user')?.content ?? '');
  }

  systemMessages(): string[] {
    return this.calls.map((c) => c.messages.find((m) => m.role === 'system')?.content ?? '');
  }
}
