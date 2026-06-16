import { useTranslations } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import { use } from 'react';
import { PageHeading } from '@/components/page-heading';

const PLANS = [
  { id: 'free', price: '$0', highlight: false, features: ['f1', 'f2', 'f3'] },
  { id: 'pro', price: '$9', highlight: true, features: ['f1', 'f2', 'f3', 'f4'] },
  { id: 'business', price: '$29', highlight: false, features: ['f1', 'f2', 'f3', 'f4', 'f5'] },
] as const;

export default function PricingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  setRequestLocale(locale);

  const t = useTranslations('Pricing');

  return (
    <div>
      <div className="text-center">
        <PageHeading title={t('title')} subtitle={t('subtitle')} />
      </div>
      <div className="mt-8 grid gap-6 md:grid-cols-3">
        {PLANS.map((plan) => (
          <div
            key={plan.id}
            className={`flex flex-col rounded-2xl border p-6 ${
              plan.highlight
                ? 'border-emerald-600 shadow-lg'
                : 'border-black/10 dark:border-white/10'
            }`}
          >
            {plan.highlight ? (
              <span className="mb-2 inline-block w-fit rounded-full bg-emerald-600 px-3 py-1 text-xs font-medium text-white">
                {t('popular')}
              </span>
            ) : null}
            <h2 className="text-lg font-semibold">{t(`plans.${plan.id}.name`)}</h2>
            <p className="mt-2">
              <span className="text-3xl font-bold">{plan.price}</span>
              <span className="opacity-60">/{t('perMonth')}</span>
            </p>
            <ul className="mt-4 flex-1 space-y-2 text-sm">
              {plan.features.map((f) => (
                <li key={f} className="flex items-start gap-2">
                  <span className="text-emerald-600">✓</span>
                  {t(`plans.${plan.id}.${f}`)}
                </li>
              ))}
            </ul>
            <button
              className={`mt-6 rounded-lg px-5 py-2.5 font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50 ${
                plan.highlight
                  ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                  : 'border border-black/15 hover:border-emerald-600 hover:bg-black/[0.02] dark:border-white/15 dark:hover:bg-white/5'
              }`}
            >
              {t('choose')}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
