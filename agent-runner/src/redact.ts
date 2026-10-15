const MIN_SECRET_LENGTH = 4;

/** Replace every secret value (4+ chars) found in `text` with `***`. */
export function redactSecrets(text: string, secrets: ReadonlyArray<string | null | undefined>): string {
  let out = text;
  // Longest first so a secret that contains another one is fully masked.
  const values = secrets
    .filter((s): s is string => typeof s === 'string' && s.length >= MIN_SECRET_LENGTH)
    .sort((a, b) => b.length - a.length);
  for (const secret of values) out = out.split(secret).join('***');
  return out;
}
