import type { Category, CategorySlug, Icon } from './types';

// Temporary in-memory catalog used until the API is wired up.
// The `art` strings are our OWN trusted static SVGs — safe to inline. User
// uploads will NEVER be inlined (see docs/SECURITY.md).

const star =
  '<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M32 6l7.6 15.4L57 24l-12.5 12.2L47.4 54 32 45.6 16.6 54l2.9-17.8L7 24l17.4-2.6L32 6z" fill="#059669"/></svg>';
const arch =
  '<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><path d="M16 56V28a16 16 0 0132 0v28h-8V28a8 8 0 00-16 0v28z" fill="#0d9488"/><rect x="12" y="56" width="40" height="4" fill="#0d9488"/></svg>';
const bowl =
  '<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><path d="M8 30h48a24 24 0 01-48 0z" fill="#ea580c"/><circle cx="32" cy="22" r="6" fill="#f59e0b"/></svg>';
const ornament =
  '<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><circle cx="32" cy="32" r="24" fill="none" stroke="#7c3aed" stroke-width="3"/><circle cx="32" cy="32" r="12" fill="none" stroke="#7c3aed" stroke-width="3"/><circle cx="32" cy="32" r="3" fill="#7c3aed"/></svg>';
const hat =
  '<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><path d="M12 44c0-14 9-24 20-24s20 10 20 24z" fill="#1d4ed8"/><rect x="10" y="44" width="44" height="6" rx="3" fill="#1e3a8a"/></svg>';
const camel =
  '<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><path d="M10 46c4-2 6-10 10-10s4 4 8 4 6-8 10-8 4 6 8 8v6H10z" fill="#b45309"/></svg>';

export const categories: Category[] = [
  { slug: 'traditional-clothing', iconCount: 128 },
  { slug: 'patterns-ornaments', iconCount: 342 },
  { slug: 'architecture', iconCount: 96 },
  { slug: 'cuisine', iconCount: 154 },
  { slug: 'silk-road', iconCount: 71 },
  { slug: 'holidays-symbols', iconCount: 88 },
  { slug: 'history-heritage', iconCount: 63 },
];

export const icons: Icon[] = [
  { id: '1', name: "Do'ppi", slug: 'doppi', category: 'traditional-clothing', priceType: 'FREE', priceCents: 0, creator: { name: 'Aziza Karimova', slug: 'aziza' }, tags: ['doppi', 'hat', 'clothing'], downloads: 4210, art: hat },
  { id: '2', name: 'Suzani Ornament', slug: 'suzani-ornament', category: 'patterns-ornaments', priceType: 'PREMIUM', priceCents: 299, creator: { name: 'Bobur Studio', slug: 'bobur' }, tags: ['suzani', 'ornament', 'pattern'], downloads: 8730, art: ornament },
  { id: '3', name: 'Registan', slug: 'registan', category: 'architecture', priceType: 'PREMIUM', priceCents: 499, creator: { name: 'Samarkand Design', slug: 'samarkand' }, tags: ['registan', 'samarkand', 'architecture'], downloads: 6120, art: arch },
  { id: '4', name: 'Plov', slug: 'plov', category: 'cuisine', priceType: 'FREE', priceCents: 0, creator: { name: 'Osh Markazi', slug: 'osh' }, tags: ['plov', 'food', 'rice'], downloads: 11200, art: bowl },
  { id: '5', name: 'Silk Road Camel', slug: 'silk-road-camel', category: 'silk-road', priceType: 'PREMIUM', priceCents: 349, creator: { name: 'Bobur Studio', slug: 'bobur' }, tags: ['camel', 'silk road', 'caravan'], downloads: 2980, art: camel },
  { id: '6', name: 'Navruz Star', slug: 'navruz-star', category: 'holidays-symbols', priceType: 'FREE', priceCents: 0, creator: { name: 'Aziza Karimova', slug: 'aziza' }, tags: ['navruz', 'star', 'holiday'], downloads: 5400, art: star },
  { id: '7', name: 'Atlas Pattern', slug: 'atlas-pattern', category: 'patterns-ornaments', priceType: 'PREMIUM', priceCents: 299, creator: { name: 'Margilan Silk', slug: 'margilan' }, tags: ['atlas', 'silk', 'pattern'], downloads: 7650, art: ornament },
  { id: '8', name: 'Bukhara Minaret', slug: 'bukhara-minaret', category: 'architecture', priceType: 'FREE', priceCents: 0, creator: { name: 'Samarkand Design', slug: 'samarkand' }, tags: ['bukhara', 'minaret', 'architecture'], downloads: 3310, art: arch },
  { id: '9', name: 'Tea Set', slug: 'tea-set', category: 'cuisine', priceType: 'PREMIUM', priceCents: 199, creator: { name: 'Osh Markazi', slug: 'osh' }, tags: ['tea', 'choy', 'set'], downloads: 4870, art: bowl },
  { id: '10', name: 'Chapan', slug: 'chapan', category: 'traditional-clothing', priceType: 'PREMIUM', priceCents: 399, creator: { name: 'Aziza Karimova', slug: 'aziza' }, tags: ['chapan', 'robe', 'clothing'], downloads: 1920, art: hat },
  { id: '11', name: 'Eternal Star', slug: 'eternal-star', category: 'holidays-symbols', priceType: 'FREE', priceCents: 0, creator: { name: 'Bobur Studio', slug: 'bobur' }, tags: ['star', 'symbol'], downloads: 6010, art: star },
  { id: '12', name: 'Caravan Route', slug: 'caravan-route', category: 'silk-road', priceType: 'PREMIUM', priceCents: 449, creator: { name: 'Margilan Silk', slug: 'margilan' }, tags: ['caravan', 'route', 'trade'], downloads: 2210, art: camel },
  { id: '13', name: 'Khan-Atlas', slug: 'khan-atlas', category: 'patterns-ornaments', priceType: 'FREE', priceCents: 0, creator: { name: 'Margilan Silk', slug: 'margilan' }, tags: ['atlas', 'khan', 'silk'], downloads: 9120, art: ornament },
  { id: '14', name: 'Shashlik', slug: 'shashlik', category: 'cuisine', priceType: 'FREE', priceCents: 0, creator: { name: 'Osh Markazi', slug: 'osh' }, tags: ['shashlik', 'kebab', 'food'], downloads: 8050, art: bowl },
  { id: '15', name: 'Khiva Gate', slug: 'khiva-gate', category: 'architecture', priceType: 'PREMIUM', priceCents: 399, creator: { name: 'Samarkand Design', slug: 'samarkand' }, tags: ['khiva', 'gate', 'architecture'], downloads: 1740, art: arch },
  { id: '16', name: 'Sumalak', slug: 'sumalak', category: 'holidays-symbols', priceType: 'PREMIUM', priceCents: 249, creator: { name: 'Aziza Karimova', slug: 'aziza' }, tags: ['sumalak', 'navruz', 'spring'], downloads: 3420, art: bowl },
  { id: '17', name: 'Telpak', slug: 'telpak', category: 'traditional-clothing', priceType: 'FREE', priceCents: 0, creator: { name: 'Bobur Studio', slug: 'bobur' }, tags: ['telpak', 'fur hat', 'clothing'], downloads: 2630, art: hat },
  { id: '18', name: 'Spice Trade', slug: 'spice-trade', category: 'silk-road', priceType: 'FREE', priceCents: 0, creator: { name: 'Margilan Silk', slug: 'margilan' }, tags: ['spice', 'trade', 'silk road'], downloads: 1980, art: camel },
];

export interface Creator {
  slug: string;
  name: string;
  iconCount: number;
}

export const creators: Creator[] = [
  { slug: 'aziza', name: 'Aziza Karimova', iconCount: 4 },
  { slug: 'bobur', name: 'Bobur Studio', iconCount: 4 },
  { slug: 'samarkand', name: 'Samarkand Design', iconCount: 3 },
  { slug: 'osh', name: 'Osh Markazi', iconCount: 3 },
  { slug: 'margilan', name: 'Margilan Silk', iconCount: 4 },
];

export function getIconsByCategory(slug: CategorySlug): Icon[] {
  return icons.filter((i) => i.category === slug);
}

export function getIconBySlug(slug: string): Icon | undefined {
  return icons.find((i) => i.slug === slug);
}

export function searchIcons(query: string, priceType?: 'FREE' | 'PREMIUM'): Icon[] {
  const q = query.trim().toLowerCase();
  return icons.filter((i) => {
    const matchesQuery =
      !q ||
      i.name.toLowerCase().includes(q) ||
      i.tags.some((t) => t.toLowerCase().includes(q));
    const matchesPrice = !priceType || i.priceType === priceType;
    return matchesQuery && matchesPrice;
  });
}

export function trendingIcons(limit = 8): Icon[] {
  return [...icons].sort((a, b) => b.downloads - a.downloads).slice(0, limit);
}

export function relatedIcons(icon: Icon, limit = 6): Icon[] {
  return icons
    .filter((i) => i.id !== icon.id && i.category === icon.category)
    .slice(0, limit);
}
