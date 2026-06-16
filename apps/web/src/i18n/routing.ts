import { defineRouting } from 'next-intl/routing';

// Supported locales: English, Uzbek, Russian. English is the default.
export const routing = defineRouting({
  locales: ['en', 'uz', 'ru'],
  defaultLocale: 'en',
  localePrefix: 'always',
});

export type Locale = (typeof routing.locales)[number];

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (routing.locales as readonly string[]).includes(value);
}

export const localeNames: Record<Locale, string> = {
  en: 'English',
  uz: "O‘zbekcha",
  ru: 'Русский',
};

// ISO 3166-1 alpha-2 country codes used to build flag image URLs (flagcdn.com).
export const localeCountryCodes: Record<Locale, string> = {
  en: 'gb',
  uz: 'uz',
  ru: 'ru',
};

// Flag image from a CDN, sized for inline use next to the locale name.
export function localeFlagUrl(locale: Locale): string {
  return `https://flagcdn.com/24x18/${localeCountryCodes[locale]}.png`;
}
