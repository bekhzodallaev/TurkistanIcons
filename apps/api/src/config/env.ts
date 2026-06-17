import { z } from 'zod';

/**
 * Environment contract for the API. Secrets come from env only (see .env.example).
 * Most datastore URLs are optional at M0 so the app and /health boot without a
 * full Docker stack; later milestones tighten these as they start depending on them.
 */
const DEV_ACCESS_SECRET = 'dev-insecure-access-secret-change-me';
const DEV_REFRESH_SECRET = 'dev-insecure-refresh-secret-change-me';

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    API_PORT: z.coerce.number().int().positive().default(4000),
    WEB_URL: z.string().url().default('http://localhost:3000'),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),

    DATABASE_URL: z.string().optional(),
    REDIS_URL: z.string().default('redis://localhost:6379'),

    // ---- Auth (M2) ----
    // Dev/test default to insecure placeholders so the app boots without config;
    // production MUST override (enforced by the refinement below).
    JWT_ACCESS_SECRET: z.string().min(1).default(DEV_ACCESS_SECRET),
    JWT_REFRESH_SECRET: z.string().min(1).default(DEV_REFRESH_SECRET),
    JWT_ACCESS_TTL: z.string().default('15m'),
    JWT_REFRESH_TTL: z.string().default('30d'),

    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),
    GOOGLE_CALLBACK_URL: z.string().url().default('http://localhost:4000/api/v1/auth/google/callback'),

    // Refresh-token cookie. Secure defaults to on in production.
    COOKIE_DOMAIN: z.string().optional(),
    COOKIE_SECURE: z
      .enum(['true', 'false'])
      .optional()
      .transform((v) => (v === undefined ? undefined : v === 'true')),

    // ---- Transactional email (Resend) ----
    // Optional: when unset, the mailer logs messages instead of sending (dev).
    RESEND_API_KEY: z.string().optional(),
    MAIL_FROM: z.string().default('TurkistanIcons <no-reply@turkistanicons.com>'),

    SENTRY_DSN: z.string().optional(),
    SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0.1),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;
    if (env.JWT_ACCESS_SECRET === DEV_ACCESS_SECRET || env.JWT_ACCESS_SECRET.length < 32) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['JWT_ACCESS_SECRET'],
        message: 'must be set to a strong (>=32 char) secret in production',
      });
    }
    if (env.JWT_REFRESH_SECRET === DEV_REFRESH_SECRET || env.JWT_REFRESH_SECRET.length < 32) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['JWT_REFRESH_SECRET'],
        message: 'must be set to a strong (>=32 char) secret in production',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

/** Used by `ConfigModule.forRoot({ validate })` — fails fast on bad config. */
export function validateEnv(config: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(config);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}
