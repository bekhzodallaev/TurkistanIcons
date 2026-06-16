// Frontend domain types. These mirror the planned API shapes (see docs/API.md)
// and will be replaced by generated/shared types once the API exists.

export type CategorySlug =
  | 'traditional-clothing'
  | 'patterns-ornaments'
  | 'architecture'
  | 'cuisine'
  | 'silk-road'
  | 'holidays-symbols'
  | 'history-heritage';

export type PriceType = 'FREE' | 'PREMIUM';

export interface Icon {
  id: string;
  name: string;
  slug: string;
  category: CategorySlug;
  priceType: PriceType;
  priceCents: number;
  creator: { name: string; slug: string };
  tags: string[];
  downloads: number;
  /** Inline decorative SVG markup (our own static content, not user upload). */
  art: string;
}

export interface Category {
  slug: CategorySlug;
  iconCount: number;
}
