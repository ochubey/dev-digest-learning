/** kebab-case slug of a name; `fallback` when nothing usable is left. */
export function toSlug(name: string, fallback: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || fallback;
}

/** Slugs for a list of names; a later duplicate gets `-2`, `-3`, ... (AC-15). */
export function uniqueSlugs(names: string[], fallback = 'skill'): string[] {
  const used = new Set<string>();
  return names.map((name) => {
    const base = toSlug(name, fallback);
    let slug = base;
    for (let n = 2; used.has(slug); n++) slug = `${base}-${n}`;
    used.add(slug);
    return slug;
  });
}
