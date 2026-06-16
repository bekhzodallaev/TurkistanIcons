import { useTranslations } from 'next-intl';

export function Footer() {
  const t = useTranslations('Footer');
  const year = new Date().getFullYear();
  return (
    <footer className="mx-auto max-w-6xl px-6 py-10 text-center text-sm opacity-60">
      <p>{t('tagline')}</p>
      <p>© {year} TurkistanIcons. {t('rights')}</p>
    </footer>
  );
}
