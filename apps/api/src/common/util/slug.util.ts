/**
 * Turn a display name into a URL-safe slug: strip diacritics, lower-case, and
 * collapse non-alphanumerics to single hyphens. Used for category/tag slugs
 * (stored citext-unique). Uniqueness is resolved by the caller (append -2, -3…).
 */
export function slugify(input: string): string {
  const slug = input
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '') // strip combining diacritical marks
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
  return slug || 'item';
}
