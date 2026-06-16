'use client';

import { useLocale } from 'next-intl';
import { useTransition } from 'react';
import { usePathname, useRouter } from '@/i18n/navigation';
import { routing, localeNames, localeFlagUrl, type Locale } from '@/i18n/routing';
import { Dropdown } from '@/components/ui/dropdown';

// Switches locale while preserving the current path. Client Component because
// it reads the active route and pushes a navigation.
export function LanguageSwitcher() {
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function onChange(next: string) {
    startTransition(() => {
      router.replace(pathname, { locale: next as Locale });
    });
  }

  const options = routing.locales.map((loc) => ({
    value: loc,
    label: localeNames[loc],
    icon: (
      // eslint-disable-next-line @next/next/no-img-element -- small static flag from CDN, not app content
      <img
        src={localeFlagUrl(loc)}
        alt=""
        width={20}
        height={15}
        className="rounded-[2px]"
      />
    ),
  }));

  return (
    <Dropdown
      aria-label="Language"
      value={locale}
      options={options}
      onChange={onChange}
      disabled={isPending}
    />
  );
}
