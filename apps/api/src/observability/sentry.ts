import * as Sentry from '@sentry/node';

/**
 * Sentry stub: initializes only when SENTRY_DSN is set, so local/dev/CI runs
 * are no-ops. Wired into the bootstrap before the app is created. Full tracing
 * + alerting is formalized in M11 (Hardening & Deployment).
 */
export function initSentry(): boolean {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return false;

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'development',
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
  });
  return true;
}

export { Sentry };
