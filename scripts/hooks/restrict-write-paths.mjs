#!/usr/bin/env node
/**
 * PreToolUse hook: restrict Write/Edit to allowed paths, limit Bash to test commands.
 * Usage: node restrict-write-paths.mjs [--bash-only] <allowed-glob-1> <allowed-glob-2> ...
 * Input: JSON from stdin
 */

import { readFileSync } from 'fs';

const args = process.argv.slice(2);
const bashOnly = args[0] === '--bash-only';
const allowedGlobs = bashOnly ? [] : args;

// Read hook input from stdin
let input;
try {
  const stdinData = readFileSync(0, 'utf-8').trim();
  input = JSON.parse(stdinData);
} catch (err) {
  console.error('Failed to parse hook input:', err.message);
  process.exit(2);
}

const { tool, file_path, command } = input;

// Simple glob matcher: supports * and **
function globMatches(path, glob) {
  // Normalize backslashes
  const p = path.replace(/\\/g, '/');
  const g = glob.replace(/\\/g, '/');

  // Handle **: match zero or more path segments
  if (g.includes('**')) {
    const parts = g.split('**/');
    if (parts.length === 2) {
      const prefix = parts[0];
      const suffix = parts[1];
      // Path must start with prefix and end with suffix pattern
      if (!p.startsWith(prefix)) return false;
      const afterPrefix = p.slice(prefix.length);
      return simpleWildcardMatch(afterPrefix, suffix);
    }
  }

  // Single * matches non-slash chars
  return simpleWildcardMatch(p, g);
}

function simpleWildcardMatch(str, pattern) {
  const regexPattern = pattern
    .replace(/\./g, '\\.')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]');
  return new RegExp(`^${regexPattern}$`).test(str);
}

// Bash-only mode: allow safe test commands
if (bashOnly) {
  if (tool === 'Bash') {
    // Allow: pnpm test, pnpm exec vitest, pnpm typecheck
    const safePatterns = [
      /^pnpm\s+(test|exec\s+vitest|typecheck)/,
      /^pnpm\s+--filter\s+\S+\s+(test|exec\s+vitest|typecheck)/,
    ];
    const isSafe = safePatterns.some(p => p.test(command));
    if (isSafe) {
      process.exit(0);
    } else {
      console.error(`Bash command not allowed: "${command}". Only pnpm test, pnpm exec vitest, pnpm typecheck are permitted.`);
      process.exit(2);
    }
  }
  // Non-Bash tools ignored in bash-only mode
  process.exit(0);
}

// Write/Edit restriction mode
if (tool === 'Write' || tool === 'Edit') {
  if (!file_path) {
    console.error(`${tool} missing file_path in hook input`);
    process.exit(2);
  }

  // Check if path matches any allowed glob
  const isAllowed = allowedGlobs.some(glob => globMatches(file_path, glob));

  if (!isAllowed) {
    console.error(
      `${tool} path not allowed: "${file_path}"\n` +
      `Allowed paths: ${allowedGlobs.join(', ')}`
    );
    process.exit(2);
  }
}

// Allow by default for unmatched tools
process.exit(0);
