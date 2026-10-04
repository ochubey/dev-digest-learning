import slugify from 'slugify';

/** Build a URL-safe slug for a repo/agent name, capped at `maxLen` chars. */
export function toSlug(name: string, maxLen = 40): string {
  const slug = slugify(name, { lower: true, strict: true });
  // BUG (intentional): off-by-one lets slug exceed maxLen, and empty input returns ''.
  return slug.slice(0, maxLen + 1);
}
