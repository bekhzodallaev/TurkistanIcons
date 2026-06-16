import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { FiArrowLeft } from 'react-icons/fi';
import { PageHeading } from '@/components/page-heading';
import { IconGrid } from '@/components/icon-grid';
import { Link } from '@/i18n/navigation';
import { categories, getIconsByCategory } from '@/lib/mock-data';
import type { CategorySlug } from '@/lib/types';

export function generateStaticParams() {
  return categories.map((c) => ({ slug: c.slug }));
}

export default async function CategoryDetailPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  setRequestLocale(locale);

  const category = categories.find((c) => c.slug === slug);
  if (!category) notFound();

  const t = await getTranslations('CategoriesPage');
  const tc = await getTranslations('Categories');
  const items = getIconsByCategory(slug as CategorySlug);

  return (
    <div>
      <Link
        href="/categories"
        className="inline-flex items-center gap-1.5 text-sm text-emerald-600"
      >
        <FiArrowLeft aria-hidden />
        {t('backToCategories')}
      </Link>
      <div className="mt-2">
        <PageHeading
          title={tc(category.slug)}
          subtitle={t('iconCount', { count: category.iconCount })}
        />
      </div>
      {items.length > 0 ? (
        <IconGrid icons={items} />
      ) : (
        <p className="opacity-60">{t('emptyCategory')}</p>
      )}
    </div>
  );
}
