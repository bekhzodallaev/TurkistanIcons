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
