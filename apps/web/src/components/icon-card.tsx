import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import type { Icon } from '@/lib/types';

// Renders trusted, first-party static SVG art. User-uploaded SVGs will be
// served from the CDN as <img>, never inlined (see docs/SECURITY.md).
export function IconCard({ icon }: { icon: Icon }) {
  const t = useTranslations('Common');
  return (
    <Link
      href={`/icon/${icon.slug}`}
      className="group flex flex-col items-center rounded-xl border border-black/10 p-4 transition hover:-translate-y-0.5 hover:shadow-md dark:border-white/10"
    >
      <div
        className="flex h-20 w-20 items-center justify-center"
        // eslint-disable-next-line react/no-danger -- trusted first-party SVG
        dangerouslySetInnerHTML={{ __html: icon.art }}
      />
      <span className="mt-3 line-clamp-1 text-sm font-medium">{icon.name}</span>
      <span className="text-xs opacity-60">
        {icon.priceType === 'FREE' ? t('free') : `$${(icon.priceCents / 100).toFixed(2)}`}
      </span>
    </Link>
  );
}
