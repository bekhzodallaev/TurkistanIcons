import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import {
  RATE_LIMIT_KEY,
  type RateLimitOptions,
} from '../decorators/rate-limit.decorator';
import { RedisService } from '../../redis/redis.service';

/**
 * Per-route rate limiting backed by Redis counters (docs/SECURITY.md §4).
 * Sets `X-RateLimit-*` headers and returns 429 + `Retry-After` on breach.
 *
 * Fail-open: if Redis is unavailable the request is allowed (Cloudflare's edge
 * rules are the volumetric-DoS defense); we never hard-fail auth on a cache miss.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly redis: RedisService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const opts = this.reflector.getAllAndOverride<RateLimitOptions | undefined>(
      RATE_LIMIT_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );
    if (!opts) return true;

    const req = ctx.switchToHttp().getRequest<Request>();
    const res = ctx.switchToHttp().getResponse<Response>();
    const bucket = opts.name ?? req.path;
    const ip = req.ip ?? 'unknown';
    let identity = ip;
    if (opts.keyBy === 'ip+email') {
      const body = req.body as { email?: unknown } | undefined;
      const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '-';
      identity = `${ip}:${email}`;
    } else if (opts.keyBy === 'user') {
      const user = (req as Request & { user?: { id?: string } }).user;
      identity = user?.id ? `user:${user.id}` : ip;
    }
    const key = `auth:rl:${bucket}:${identity}`;

    let count: number;
    let ttl: number;
    try {
      ({ count, ttl } = await this.redis.incrementWithWindow(key, opts.windowSeconds));
    } catch (err) {
      this.logger.warn(`Rate limiter unavailable, failing open: ${(err as Error).message}`);
      return true;
    }

    const remaining = Math.max(0, opts.limit - count);
    const resetEpoch = Math.floor(Date.now() / 1000) + Math.max(ttl, 0);
    res.setHeader('X-RateLimit-Limit', opts.limit);
    res.setHeader('X-RateLimit-Remaining', remaining);
    res.setHeader('X-RateLimit-Reset', resetEpoch);

    if (count > opts.limit) {
      res.setHeader('Retry-After', Math.max(ttl, 1));
      throw new HttpException(
        `Rate limit exceeded. Retry after ${Math.max(ttl, 1)}s.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}
