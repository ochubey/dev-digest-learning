/**
 * Safe structured logging for prompt assembly.
 *
 * Log section boundaries, lengths, token estimates, model selection, and
 * timing — while NEVER logging secrets (keys, tokens), full bodies, or
 * private content.
 *
 * Works with an injected logger (pino-like: { info, debug, warn, error }) or
 * checks DEBUG env var for verbose mode.
 */

/**
 * Structured log entry for a single prompt section.
 */
export interface PromptLogEntry {
  /** Name of the section (e.g., 'task', 'pr_description', 'diff', 'intent'). */
  sectionName: string;
  /** Where this section came from (e.g., 'PR title', 'git diff', 'intent classifier'). */
  source: string;
  /** Length of the section in characters (before wrapping). */
  lengthChars: number;
  /** Estimated token count (optional; word count / 4 as rough proxy). */
  lengthTokens?: number;
  /** Model name if this section requires/came from an LLM call (optional). */
  selectedModel?: string;
  /** Correlation ID to trace this prompt assembly across logs (optional). */
  correlationId?: string;
}

/**
 * Minimal pino-like logger interface for injection.
 */
export interface Logger {
  debug?: (obj: unknown, msg?: string) => void;
  info?: (obj: unknown, msg?: string) => void;
  warn?: (obj: unknown, msg?: string) => void;
  error?: (obj: unknown, msg?: string) => void;
}

/**
 * Check whether verbose logging is enabled.
 * Returns true if:
 *   1. DEBUG env var contains 'devdigest:prompt' or 'devdigest*' or '*'
 *   2. Logger level is 'debug' or lower (if logger has a level property)
 */
export function shouldLogVerbose(logger?: Logger & { level?: string }): boolean {
  // Check DEBUG env var (works in Node.js)
  const debugEnv = typeof process !== 'undefined' && process.env?.DEBUG;
  if (debugEnv) {
    const patterns = debugEnv.split(',').map((p) => p.trim());
    if (patterns.includes('*') || patterns.includes('devdigest*') || patterns.includes('devdigest:prompt')) {
      return true;
    }
  }

  // Check logger.level if available
  if (logger?.level) {
    const levels: Record<string, number> = {
      trace: 10,
      debug: 20,
      info: 30,
      warn: 40,
      error: 50,
      fatal: 60,
      silent: 100,
    };
    const level = levels[logger.level.toLowerCase()] ?? 30;
    if (level <= 20) return true; // debug or lower
  }

  return false;
}

/**
 * Truncate a string to a max length, appending "…" if truncated.
 */
function truncateForLog(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + '…';
}

/**
 * Estimate token count from character count.
 * Rough proxy: average word is 4 chars, average word is 1.3 tokens.
 * So: chars / 4 = words, words * 1.3 ≈ tokens, simplifying to chars / 3.
 */
function estimateTokens(chars: number): number {
  return Math.ceil(chars / 3);
}

/**
 * Safely log a single prompt section.
 *
 * Logs structured data: section name, source, length, tokens, model, correlation ID.
 * NEVER logs: secret values, full section bodies, private paths, email addresses.
 *
 * @param logger Optional injected logger (pino-like). If omitted, logs to console.debug in verbose mode.
 * @param entry Structured log entry for this section.
 */
export function safeLogSection(logger: Logger | undefined, entry: PromptLogEntry): void {
  if (!shouldLogVerbose(logger as Logger & { level?: string })) {
    return; // Only log in verbose mode
  }

  const { sectionName, source, lengthChars, lengthTokens, selectedModel, correlationId } = entry;

  // Estimate tokens if not provided
  const tokens = lengthTokens ?? estimateTokens(lengthChars);

  // Build safe log object (no secrets, full bodies, etc.)
  const logObj = {
    section: sectionName,
    source,
    lengthChars,
    estimatedTokens: tokens,
    ...(selectedModel && { model: selectedModel }),
    ...(correlationId && { correlationId }),
  };

  const msg = `prompt section: ${sectionName} (${source}, ${lengthChars} chars)`;

  if (logger?.debug) {
    logger.debug(logObj, msg);
  } else if (typeof console !== 'undefined' && console.debug) {
    console.debug(`[devdigest:prompt] ${msg}`, logObj);
  }
}

/**
 * Log each section of a PromptParts assembly.
 *
 * Walks through the assembled prompt and logs each section that is present,
 * along with optional model and correlation ID.
 *
 * @param logger Optional injected logger.
 * @param parts Object with section properties (system, task, prDescription, intent, skills, memory, specs, repoMap, callers, diff).
 * @param model Optional model name being used for this prompt.
 * @param correlationId Optional correlation ID to trace this assembly.
 */
export function safeLogPromptAssembly(
  logger: Logger | undefined,
  parts: Record<string, string | string[] | undefined>,
  model?: string,
  correlationId?: string,
): void {
  if (!shouldLogVerbose(logger as Logger & { level?: string })) {
    return;
  }

  // Define the sections we care about and their sources
  const sectionConfigs: Array<{
    key: keyof typeof parts;
    sectionName: string;
    source: string;
  }> = [
    { key: 'system', sectionName: 'system', source: 'agent system prompt' },
    { key: 'task', sectionName: 'task', source: 'PR framing' },
    { key: 'prDescription', sectionName: 'pr_description', source: 'PR body' },
    { key: 'intent', sectionName: 'intent', source: 'intent classifier' },
    { key: 'skills', sectionName: 'skills', source: 'community/project skills' },
    { key: 'memory', sectionName: 'memory', source: 'retrieved memory' },
    { key: 'specs', sectionName: 'specs', source: 'project specs' },
    { key: 'repoMap', sectionName: 'repo_map', source: 'repo skeleton' },
    { key: 'callers', sectionName: 'callers', source: 'callers digest' },
    { key: 'diff', sectionName: 'diff', source: 'git diff' },
  ];

  for (const config of sectionConfigs) {
    const value = parts[config.key];
    if (!value) continue; // Skip empty sections

    let lengthChars = 0;
    if (typeof value === 'string') {
      lengthChars = value.length;
    } else if (Array.isArray(value)) {
      lengthChars = value.join('\n').length;
    }

    safeLogSection(logger, {
      sectionName: config.sectionName,
      source: config.source,
      lengthChars,
      selectedModel: model,
      correlationId,
    });
  }
}
