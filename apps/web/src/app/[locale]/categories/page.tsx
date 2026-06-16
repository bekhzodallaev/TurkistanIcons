import { useTranslations } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import { use } from 'react';
import { Link } from '@/i18n/navigation';
import { PageHeading } from '@/components/page-heading';
import { categories } from '@/lib/mock-data';

export default function CategoriesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  setRequestLocale(locale);

  const t = useTranslations('CategoriesPage');
  const tc = useTranslations('Categories');

  return (
    <div>
      <PageHeading title={t('title')} subtitle={t('subtitle')} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {categories.map((category) => (
          <Link
            key={category.slug}
            href={`/category/${category.slug}`}
            className="rounded-xl border border-black/10 p-6 transition hover:border-emerald-500/60 hover:bg-black/[0.02] hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50 dark:border-white/10 dark:hover:border-emerald-500/60 dark:hover:bg-white/5"
          >
            <h2 className="text-lg font-semibold">{tc(category.slug)}</h2>
            <p className="mt-1 text-sm opacity-60">
              {t('iconCount', { count: category.iconCount })}
            </p>
          </Link>
        ))}
      </div>
    </div>
  );
}
