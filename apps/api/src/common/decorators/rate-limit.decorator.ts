import { SetMetadata } from '@nestjs/common';

export const RATE_LIMIT_KEY = 'rateLimit';

export interface RateLimitOptions {
  /** Max requests allowed within the window. */
  limit: number;
  /** Sliding window length in seconds. */
  windowSeconds: number;
  /**
   * How to bucket callers:
   *  - 'ip'        → per client IP
   *  - 'ip+email'  → per (IP, body.email) pair (stricter for auth endpoints)
   */
  keyBy?: 'ip' | 'ip+email';
  /** Stable name used in the Redis key (defaults to the route path). */
  name?: string;
}

/**
 * Declares a Redis-backed rate limit for a route. Enforced by RateLimitGuard.
 * Auth endpoints (login/register/reset/refresh) are strictly limited per
 * docs/SECURITY.md §4.
 */
export const RateLimit = (options: RateLimitOptions): MethodDecorator =>
  SetMetadata(RATE_LIMIT_KEY, options);
