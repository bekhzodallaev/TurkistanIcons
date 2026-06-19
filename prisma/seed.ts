/**
 * Seed: cultural category tree + starter taxonomy for TurkistanIcons.
 *
 * Idempotent — upserts by unique slug, so it is safe to run repeatedly
 * (`pnpm --filter @turkistan/api prisma:seed`). See docs/ROADMAP.md (M1).
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/** Top-level categories, each with cultural child categories from the PRD. */
const CATEGORY_TREE: Array<{
  name: string;
  slug: string;
  description: string;
  children: Array<{ name: string; slug: string; description: string }>;
}> = [
  {
    name: 'Clothing & Textiles',
    slug: 'clothing-textiles',
    description: 'Traditional Uzbek and Central Asian garments and fabric arts.',
    children: [
      { name: "Do'ppi", slug: 'doppi', description: 'Traditional Uzbek embroidered skullcaps.' },
      { name: 'Atlas Patterns', slug: 'atlas', description: 'Ikat-dyed atlas and adras silk patterns.' },
      { name: 'Suzani Ornaments', slug: 'suzani', description: 'Hand-embroidered suzani textile ornaments.' },
    ],
  },
  {
    name: 'Architecture',
    slug: 'architecture',
    description: 'Monuments and architectural heritage of the Silk Road cities.',
    children: [
      { name: 'Registan', slug: 'registan', description: 'The Registan ensemble of Samarkand.' },
      { name: 'Bukhara', slug: 'bukhara', description: 'Historic architecture of Bukhara.' },
    ],
  },
  {
    name: 'Cuisine',
    slug: 'cuisine',
    description: 'Food, drink, and culinary traditions of Central Asia.',
    children: [
      { name: 'Plov', slug: 'plov', description: 'Plov (osh) — the national rice dish.' },
      { name: 'Tea Sets', slug: 'tea-sets', description: 'Traditional teapots, piyola bowls, and tea culture.' },
    ],
  },
  {
    name: 'Heritage & Symbols',
    slug: 'heritage-symbols',
    description: 'Historical and cultural symbols of the region.',
    children: [
      { name: 'Silk Road', slug: 'silk-road', description: 'Caravans, trade routes, and Silk Road motifs.' },
      { name: 'Navruz', slug: 'navruz', description: 'Navruz spring festival symbols and motifs.' },
    ],
  },
];

/** Starter tags (name + slug). Cultural vocabulary the search index leans on. */
const TAGS: Array<{ name: string; slug: string }> = [
  { name: 'doppi', slug: 'doppi' },
  { name: 'atlas', slug: 'atlas' },
  { name: 'suzani', slug: 'suzani' },
  { name: 'embroidery', slug: 'embroidery' },
  { name: 'ornament', slug: 'ornament' },
  { name: 'pattern', slug: 'pattern' },
  { name: 'registan', slug: 'registan' },
  { name: 'bukhara', slug: 'bukhara' },
  { name: 'architecture', slug: 'architecture' },
  { name: 'plov', slug: 'plov' },
  { name: 'osh', slug: 'osh' },
  { name: 'tea', slug: 'tea' },
  { name: 'ceramics', slug: 'ceramics' },
  { name: 'silk road', slug: 'silk-road' },
  { name: 'navruz', slug: 'navruz' },
  { name: 'traditional', slug: 'traditional' },
  { name: 'uzbek', slug: 'uzbek' },
  { name: 'central asia', slug: 'central-asia' },
];

async function main(): Promise<void> {
  let parentOrder = 0;
  for (const parent of CATEGORY_TREE) {
    const parentRow = await prisma.category.upsert({
      where: { slug: parent.slug },
      update: { name: parent.name, description: parent.description, sortOrder: parentOrder },
      create: { name: parent.name, slug: parent.slug, description: parent.description, sortOrder: parentOrder },
    });
    parentOrder += 1;

    let childOrder = 0;
    for (const child of parent.children) {
      await prisma.category.upsert({
        where: { slug: child.slug },
        update: {
          name: child.name,
          description: child.description,
          parentId: parentRow.id,
          sortOrder: childOrder,
        },
        create: {
          name: child.name,
          slug: child.slug,
          description: child.description,
          parentId: parentRow.id,
          sortOrder: childOrder,
        },
      });
      childOrder += 1;
    }
  }

  for (const tag of TAGS) {
    await prisma.tag.upsert({
      where: { slug: tag.slug },
      update: { name: tag.name },
      create: { name: tag.name, slug: tag.slug },
    });
  }

  const categoryCount = await prisma.category.count();
  const tagCount = await prisma.tag.count();
  // eslint-disable-next-line no-console
  console.log(`Seed complete: ${categoryCount} categories, ${tagCount} tags.`);
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('Seed failed:', err);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
