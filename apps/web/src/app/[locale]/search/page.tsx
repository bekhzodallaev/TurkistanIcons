import { getTranslations, setRequestLocale } from 'next-intl/server';
import { PageHeading } from '@/components/page-heading';
import { IconGrid } from '@/components/icon-grid';
import { Link } from '@/i18n/navigation';
import { searchIcons } from '@/lib/mock-data';
import type { PriceType } from '@/lib/types';

type SearchParams = { q?: string; price?: string };

export default async function SearchPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { q = '', price } = await searchParams;

  const t = await getTranslations('Search');
  const priceFilter: PriceType | undefined =
    price === 'FREE' || price === 'PREMIUM' ? price : undefined;
  const results = searchIcons(q, priceFilter);

  const filters: { label: string; value?: PriceType }[] = [
    { label: t('all'), value: undefined },
    { label: t('free'), value: 'FREE' },
    { label: t('premium'), value: 'PREMIUM' },
  ];

  function filterHref(value?: PriceType) {
    const sp = new URLSearchParams();
    if (q) sp.set('q', q);
    if (value) sp.set('price', value);
    const qs = sp.toString();
    return `/search${qs ? `?${qs}` : ''}`;
  }

  return (
    <div>
      <PageHeading title={q ? t('resultsFor', { query: q }) : t('title')} />

      <form action={`/${locale}/search`} className="mb-4 flex max-w-md gap-2">
        <input
          name="q"
          defaultValue={q}
          placeholder={t('placeholder')}
          className="w-full rounded-lg border border-black/15 px-4 py-2"
        />
        {priceFilter ? <input type="hidden" name="price" value={priceFilter} /> : null}
        <button className="rounded-lg bg-emerald-600 px-5 py-2 font-medium text-white">
          {t('searchButton')}
        </button>
      </form>

      <div className="mb-6 flex gap-2">
        {filters.map((f) => {
          const active = f.value === priceFilter;
          return (
            <Link
              key={f.label}
              href={filterHref(f.value)}
              className={`rounded-full border px-4 py-1 text-sm transition ${
                active
                  ? 'border-emerald-600 bg-emerald-600 text-white'
                  : 'border-black/15 hover:border-emerald-600'
              }`}
            >
              {f.label}
            </Link>
          );
        })}
      </div>

      <p className="mb-4 text-sm opacity-60">{t('results', { count: results.length })}</p>

      {results.length > 0 ? (
        <IconGrid icons={results} />
      ) : (
        <p className="opacity-60">{t('noResults')}</p>
      )}
    </div>
  );
}
