'use client';

import { useLocale } from 'next-intl';
import { useTransition } from 'react';
import { usePathname, useRouter } from '@/i18n/navigation';
import { routing, localeNames, type Locale } from '@/i18n/routing';

// Switches locale while preserving the current path. Client Component because
// it reads the active route and pushes a navigation.
export function LanguageSwitcher() {
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function onChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const next = event.target.value as Locale;
    startTransition(() => {
      router.replace(pathname, { locale: next });
    });
  }

  return (
    <select
      aria-label="Language"
      value={locale}
      onChange={onChange}
      disabled={isPending}
      className="rounded-md border border-black/15 bg-transparent px-2 py-1 text-sm"
    >
      {routing.locales.map((loc) => (
        <option key={loc} value={loc}>
          {localeNames[loc]}
        </option>
      ))}
    </select>
  );
}
