import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';

// Detects the locale and rewrites/redirects to the locale-prefixed path.
export default createMiddleware(routing);

export const config = {
  // Match all paths except API routes, Next internals, and static files.
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
