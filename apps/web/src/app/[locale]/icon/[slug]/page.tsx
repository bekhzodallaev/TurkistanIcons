import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { IconGrid } from '@/components/icon-grid';
import { Link } from '@/i18n/navigation';
import { getIconBySlug, icons, relatedIcons } from '@/lib/mock-data';

export function generateStaticParams() {
  return icons.map((i) => ({ slug: i.slug }));
}

export default async function IconDetailPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  setRequestLocale(locale);

  const icon = getIconBySlug(slug);
  if (!icon) notFound();

  const t = await getTranslations('IconDetail');
  const tc = await getTranslations('Categories');
  const isFree = icon.priceType === 'FREE';
  const related = relatedIcons(icon);

  return (
    <div className="space-y-10">
      <div className="grid gap-8 md:grid-cols-[280px_1fr]">
        <div className="flex aspect-square items-center justify-center rounded-2xl border border-black/10 bg-black/[0.02] p-10">
          <div
            className="h-40 w-40"
            // eslint-disable-next-line react/no-danger -- trusted first-party SVG
            dangerouslySetInnerHTML={{ __html: icon.art }}
          />
        </div>

        <div>
          <Link href={`/category/${icon.category}`} className="text-sm text-emerald-600">
            {tc(icon.category)}
          </Link>
          <h1 className="mt-1 text-3xl font-bold">{icon.name}</h1>
          <p className="mt-2 text-sm opacity-70">
            {t('by')}{' '}
            <Link href={`/creator/${icon.creator.slug}`} className="underline">
              {icon.creator.name}
            </Link>
          </p>
          <p className="mt-1 text-sm opacity-60">
            {t('downloads', { count: icon.downloads })}
          </p>

          <div className="mt-6 flex items-center gap-3">
            {isFree ? (
              <button className="rounded-lg bg-emerald-600 px-6 py-3 font-medium text-white">
                {t('download')}
              </button>
            ) : (
              <button className="rounded-lg bg-emerald-600 px-6 py-3 font-medium text-white">
                {t('buy', { price: `$${(icon.priceCents / 100).toFixed(2)}` })}
              </button>
            )}
            <span className="text-sm opacity-60">
              {isFree ? t('freeLicense') : t('premiumLicense')}
            </span>
          </div>

          <div className="mt-8">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide opacity-60">
              {t('tags')}
            </h2>
            <div className="flex flex-wrap gap-2">
              {icon.tags.map((tag) => (
                <Link
                  key={tag}
                  href={`/search?q=${encodeURIComponent(tag)}`}
                  className="rounded-full border border-black/15 px-3 py-1 text-sm hover:border-emerald-600"
                >
                  {tag}
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>

      {related.length > 0 ? (
        <section>
          <h2 className="mb-4 text-xl font-semibold">{t('related')}</h2>
          <IconGrid icons={related} />
        </section>
      ) : null}
    </div>
  );
}
