import { getRequestConfig } from 'next-intl/server';
import { routing, isLocale } from './routing';

// Loads the message catalog for the active request locale (Server Components).
export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = isLocale(requested) ? requested : routing.defaultLocale;

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
