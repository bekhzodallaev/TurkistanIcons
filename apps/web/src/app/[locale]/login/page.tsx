import { useTranslations } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import { use } from 'react';
import { Link } from '@/i18n/navigation';

export default function LoginPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  setRequestLocale(locale);

  const t = useTranslations('Auth');

  return (
    <div className="mx-auto max-w-sm">
      <h1 className="text-2xl font-bold">{t('signIn')}</h1>
      <form className="mt-6 space-y-4">
        <label className="block">
          <span className="text-sm">{t('email')}</span>
          <input
            type="email"
            required
            className="mt-1 w-full rounded-lg border border-black/15 px-3 py-2"
          />
        </label>
        <label className="block">
          <span className="text-sm">{t('password')}</span>
          <input
            type="password"
            required
            className="mt-1 w-full rounded-lg border border-black/15 px-3 py-2"
          />
        </label>
        <button className="w-full rounded-lg bg-emerald-600 px-4 py-2.5 font-medium text-white">
          {t('signIn')}
        </button>
      </form>
      <p className="mt-4 text-sm opacity-70">
        {t('noAccount')}{' '}
        <Link href="/register" className="text-emerald-600 underline">
          {t('signUp')}
        </Link>
      </p>
    </div>
  );
}
