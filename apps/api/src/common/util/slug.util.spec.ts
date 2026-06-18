import { slugify } from './slug.util';

describe('slugify', () => {
  it('lower-cases and hyphenates', () => {
    expect(slugify('Tea Sets')).toBe('tea-sets');
  });

  it('strips diacritics', () => {
    expect(slugify("Do'ppi")).toBe('do-ppi');
    expect(slugify('Návruz')).toBe('navruz');
  });

  it('collapses runs of non-alphanumerics and trims hyphens', () => {
    expect(slugify('  Silk   Road!!  ')).toBe('silk-road');
    expect(slugify('--Hello--World--')).toBe('hello-world');
  });

  it('falls back to "item" for empty/symbol-only input', () => {
    expect(slugify('!!!')).toBe('item');
    expect(slugify('')).toBe('item');
  });
});
