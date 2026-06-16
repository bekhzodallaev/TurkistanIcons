import { useTranslations } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import { use } from 'react';
import { Link } from '@/i18n/navigation';
import { IconGrid } from '@/components/icon-grid';
import { trendingIcons } from '@/lib/mock-data';

const CATEGORY_SLUGS = [
  'traditional-clothing',
  'patterns-ornaments',
  'architecture',
  'cuisine',
  'silk-road',
  'holidays-symbols',
  'history-heritage',
] as const;

export default function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  setRequestLocale(locale);

  const t = useTranslations('Home');
  const tc = useTranslations('Categories');
  const trending = trendingIcons(12);

  return (
    <div className="space-y-10">
      <section className="rounded-2xl bg-emerald-50 p-10 text-center dark:bg-emerald-950/30">
        <h1 className="text-3xl font-bold sm:text-4xl">{t('heroTitle')}</h1>
        <p className="mx-auto mt-3 max-w-2xl opacity-70">{t('heroSubtitle')}</p>
        <form action={`/${locale}/search`} className="mx-auto mt-6 flex max-w-md gap-2">
          <input
            name="q"
            placeholder={t('searchPlaceholder')}
            className="w-full rounded-lg border border-black/15 px-4 py-2"
          />
          <button className="rounded-lg bg-emerald-600 px-5 py-2 font-medium text-white">
            {t('searchButton')}
          </button>
        </form>
      </section>

      <section>
        <h2 className="mb-4 text-xl font-semibold">{t('browseCategories')}</h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {CATEGORY_SLUGS.map((slug) => (
            <Link
              key={slug}
              href={`/category/${slug}`}
              className="rounded-xl border border-black/10 p-5 transition hover:shadow-md"
            >
              <span className="font-medium">{tc(slug)}</span>
            </Link>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-4 text-xl font-semibold">{t('trending')}</h2>
        <IconGrid icons={trending} />
      </section>
    </div>
  );
}
