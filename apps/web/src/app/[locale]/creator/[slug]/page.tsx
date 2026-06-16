import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { PageHeading } from '@/components/page-heading';
import { IconGrid } from '@/components/icon-grid';
import { creators, icons } from '@/lib/mock-data';

export function generateStaticParams() {
  return creators.map((c) => ({ slug: c.slug }));
}

export default async function CreatorPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  setRequestLocale(locale);

  const creator = creators.find((c) => c.slug === slug);
  if (!creator) notFound();

  const t = await getTranslations('Creator');
  const creatorIcons = icons.filter((i) => i.creator.slug === slug);

  return (
    <div>
      <div className="mb-6 flex items-center gap-4">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-xl font-bold text-emerald-700 dark:bg-emerald-900/40">
          {creator.name.charAt(0)}
        </div>
        <PageHeading
          title={creator.name}
          subtitle={t('iconCount', { count: creatorIcons.length })}
        />
      </div>
      <IconGrid icons={creatorIcons} />
    </div>
  );
}
