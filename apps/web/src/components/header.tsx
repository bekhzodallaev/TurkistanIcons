import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { LanguageSwitcher } from './language-switcher';

export function Header() {
  const t = useTranslations('Nav');
  return (
    <header className="border-b border-black/10 px-6 py-4">
      <nav className="mx-auto flex max-w-6xl items-center justify-between gap-4">
        <Link href="/" className="text-lg font-bold">
          Turkistan<span className="text-emerald-600">Icons</span>
        </Link>
        <div className="flex items-center gap-4 text-sm">
          <Link href="/categories">{t('categories')}</Link>
          <Link href="/search">{t('search')}</Link>
          <Link href="/pricing">{t('pricing')}</Link>
          <Link href="/login">{t('signIn')}</Link>
          <LanguageSwitcher />
        </div>
      </nav>
    </header>
  );
}
