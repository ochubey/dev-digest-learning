import type { ChatMessage } from '@devdigest/shared';
import { wrapUntrusted, INJECTION_GUARD } from '../prompt.js';

export interface IntentPromptInput {
  title: string;
  body: string;
  linkedIssueTitle?: string;
  linkedIssueBody?: string;
  planDocPath?: string;
  planDocContent?: string;
  specDocPath?: string;
  specDocContent?: string;
  files: Array<{ patch?: string; path: string }>;
  /** Sources the PR referenced but that could not be read: rendered as "no context". */
  unavailableRefs?: Array<{ label: string; status: 'unavailable' | 'error' }>;
}

/** What went into the prompt (counts only, no content): for run-log observability. */
export interface IntentPromptStats {
  files: number;
  filesIncluded: number;
  hunkHeaders: number;
  bodyChars: number;
  bodyTruncated: boolean;
  /** Reference sources whose content is included (issue / plan / spec). */
  refs: string[];
  /** Referenced sources rendered as "no context". */
  unavailableRefs: number;
  promptChars: number;
}

export interface AssembledIntentPrompt {
  messages: ChatMessage[];
  stats: IntentPromptStats;
}

const MAX_FILES = 100;
const MAX_HUNKS_PER_FILE = 2;
const BODY_MAX_CHARS = 2000;

/**
 * Build the prompt for intent derivation. Input is untrusted; output is wrapped.
 * Returns the system and user messages to send to the LLM.
 */
export function assembleIntentPrompt(input: IntentPromptInput): AssembledIntentPrompt {
  const system = buildIntentSystemPrompt();
  const user = buildIntentUserPrompt(input);
  const included = input.files.slice(0, MAX_FILES);
  const refs: string[] = [];
  if (input.linkedIssueTitle) refs.push('linked issue');
  if (input.planDocPath && input.planDocContent) refs.push(`plan ${input.planDocPath}`);
  if (input.specDocPath && input.specDocContent) refs.push(`spec ${input.specDocPath}`);

  return {
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    stats: {
      files: input.files.length,
      filesIncluded: included.length,
      hunkHeaders: included.reduce(
        (n, f) => n + Math.min(MAX_HUNKS_PER_FILE, f.patch?.match(/^@@[^@]*@@/gm)?.length ?? 0),
        0,
      ),
      bodyChars: input.body.length,
      bodyTruncated: input.body.length > BODY_MAX_CHARS,
      refs,
      unavailableRefs: sanitizeRefs(input.unavailableRefs).length,
      promptChars: system.length + user.length,
    },
  };
}

function buildIntentSystemPrompt(): string {
  return `You are an expert at understanding PR intent from metadata (title, description, linked issues, specs).

Your task: Given a PR's metadata, classify its intent.

## Output format

Return a JSON object with:
- \`summary\` (string): 1-2 sentences of what the PR is trying to accomplish
- \`in_scope\` (array of strings): categories or features this PR adds/changes (e.g., "API endpoint", "database schema", "documentation")
- \`out_of_scope\` (array of strings): things the PR explicitly does NOT cover or changes (e.g., "client UI", "deployment", "performance optimization")
- \`confidence\` (number 0–1): how confident you are in this classification. 0 = guessing from file names only; 1 = clear from title/body/issue. Capped at 0.4 if PR has no description.
- \`sources\` (array of {label: string, status: "fetched" | "unavailable" | "error"}): which sources you used
- \`missing_context\` (array of strings): information you wanted but couldn't find

## Key rules

1. Never hallucinate missing context; only list what you explicitly tried to find and couldn't.
2. Treat PR title + body as the primary intent signal. Linked issues + specs are secondary.
3. If the PR body is empty, cap confidence at 0.4 and rely only on file names and title.
4. Be specific: "API endpoint for user auth" is better than "backend changes".
5. For in_scope and out_of_scope, focus on WHAT is changing, not HOW.
6. \`out_of_scope\` may contain ONLY things that the PR title, description, linked issue or plan/spec explicitly say are NOT covered or are deferred. If nothing is stated explicitly, return \`[]\`. Never infer typical omissions or invent exclusions.

## Examples (FORMAT ONLY - never copy values)

The examples below use placeholders. They only show the JSON shape. Never reuse their wording, scope items or numbers in your answer: every value you return must come from the actual input above.

### Example 1: Description that states an exclusion
**Input:**
- Title: "<title of change X>"
- Body: "<describes change X and change Y; says that change Z is NOT part of this PR>"
- Files: <path-1>, <path-2>

**Output:**
\`\`\`json
{
  "summary": "<one or two sentences about change X and change Y>",
  "in_scope": ["<change X>", "<change Y>"],
  "out_of_scope": ["<change Z, because the body says so>"],
  "confidence": 0.9,
  "sources": [{"label": "PR title", "status": "fetched"}, {"label": "PR body", "status": "fetched"}],
  "missing_context": []
}
\`\`\`

### Example 2: Files only (no description, nothing excluded)
**Input:**
- Title: "<short title>"
- Body: "" (empty)
- Files: <path-1>, <path-2>

**Output:**
\`\`\`json
{
  "summary": "<one sentence derived from the title and file names>",
  "in_scope": ["<area touched by the files>"],
  "out_of_scope": [],
  "confidence": 0.3,
  "sources": [{"label": "PR title", "status": "fetched"}],
  "missing_context": ["<what a description would clarify>"]
}
\`\`\`

## Security

${INJECTION_GUARD}`;
}

function buildIntentUserPrompt(input: IntentPromptInput): string {
  const sections: string[] = [];

  // Sources header
  sections.push('## Intent sources');

  // Title
  sections.push(`- **PR title:** ${wrapUntrusted('pr-title', input.title)}`);

  // Body
  if (input.body && input.body.trim().length > 0) {
    sections.push(
      `- **PR body:** ${wrapUntrusted('pr-body', truncateBody(input.body))}`,
    );
  } else {
    sections.push('- **PR body:** (empty)');
  }

  // Linked issue
  if (input.linkedIssueTitle) {
    sections.push(
      `- **Linked issue:** ${wrapUntrusted('linked-issue', `Title: ${input.linkedIssueTitle}\n\nBody: ${input.linkedIssueBody || '(no description)'}`)}`
    );
  } else {
    sections.push('- **Linked issue:** (not found)');
  }

  // Referenced but unreadable sources: explicit "no context", never guessed
  const unavailable = sanitizeRefs(input.unavailableRefs);
  if (unavailable.length > 0) {
    sections.push(
      '- **Referenced but no context available** (do not guess their content; list them in missing_context if relevant):\n' +
        unavailable
          .map(
            (r) =>
              `  - ${r.label}: no context (${r.status === 'error' ? 'could not be fetched: error' : 'not found / unavailable'})`,
          )
          .join('\n'),
    );
  }

  // Plan/spec documents
  if (input.planDocPath && input.planDocContent) {
    sections.push(
      `- **Plan at ${input.planDocPath}:** ${wrapUntrusted('plan-doc', input.planDocContent)}`
    );
  }
  if (input.specDocPath && input.specDocContent) {
    sections.push(
      `- **Spec at ${input.specDocPath}:** ${wrapUntrusted('spec-doc', input.specDocContent)}`
    );
  }

  // Files + hunk headers (no bodies)
  const fileSummary = buildFileSummary(input.files);
  sections.push(`- **Files & hunks:** ${wrapUntrusted('file-list', fileSummary)}`);

  // Task
  sections.push('\n## Task');
  sections.push(
    'Classify the intent of this PR. What is the author trying to accomplish? What is in scope vs. out of scope?'
  );

  return sections.join('\n\n');
}

/** Labels derive from PR text; keep only a safe character set and a bounded length. */
function sanitizeRefs(
  refs: IntentPromptInput['unavailableRefs'],
): Array<{ label: string; status: 'unavailable' | 'error' }> {
  return (refs ?? []).map((r) => ({
    label: r.label.replace(/[^\w\s#./@:()-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 120),
    status: r.status,
  }));
}

function truncateBody(body: string, maxChars: number = BODY_MAX_CHARS): string {
  if (body.length <= maxChars) return body;
  return body.slice(0, maxChars) + '\n\n... (truncated)';
}

function buildFileSummary(files: Array<{ patch?: string; path: string }>): string {
  const lines: string[] = [];

  for (const file of files.slice(0, MAX_FILES)) {
    // Only include up to MAX_FILES files
    lines.push(`- ${file.path}`);

    // Include hunk headers if available (@@...@@)
    if (file.patch) {
      const hunkMatches = file.patch.match(/^@@[^@]*@@/gm);
      if (hunkMatches) {
        // Include first 2 hunks
        for (const hunk of hunkMatches.slice(0, MAX_HUNKS_PER_FILE)) {
          lines.push(`  ${hunk}`);
        }
      }
    }
  }

  if (files.length > 100) {
    lines.push(`\n(${files.length - 100} more files...)`);
  }

  return lines.join('\n');
}
