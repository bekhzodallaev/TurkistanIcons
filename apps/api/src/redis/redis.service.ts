import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import type { Env } from '../config/env';

/**
 * Thin wrapper around a single ioredis connection, provided globally.
 *
 * Used by auth (rotating refresh-token families, email-verification and
 * password-reset tokens) and by the Redis-backed rate limiter. Connects lazily
 * so the API and /health boot even when Redis is unavailable (parity with
 * PrismaService); the first command that needs Redis triggers the connect.
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private errorLogged = false;
  readonly client: Redis;

  constructor(@Inject(ConfigService) config: ConfigService<Env, true>) {
    const url = config.get('REDIS_URL', { infer: true });
    this.client = new Redis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 2,
      // Keep retrying in the background rather than crashing the process.
      retryStrategy: (times) => Math.min(times * 200, 2000),
    });
    // Log the first error of a disconnected streak only, to avoid flooding logs
    // when Redis is down (it reconnects every ~2s). Reset on a successful ready.
    this.client.on('error', (err) => {
      if (!this.errorLogged) {
        this.logger.warn(`Redis connection error: ${err.message || err.name}`);
        this.errorLogged = true;
      }
    });
    this.client.on('ready', () => {
      this.errorLogged = false;
    });
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.client.connect();
      this.logger.log('Redis connected');
    } catch (err) {
      this.logger.warn(
        `Redis could not connect at startup (${(err as Error).message}); will retry on first use`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.client.disconnect();
  }

  /** Set a string value with a TTL (seconds). */
  async setEx(key: string, value: string, ttlSeconds: number): Promise<void> {
    await this.client.set(key, value, 'EX', ttlSeconds);
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async del(...keys: string[]): Promise<void> {
    if (keys.length) await this.client.del(...keys);
  }

  /** Atomically take a value and delete it — single-use token consumption. */
  async getDel(key: string): Promise<string | null> {
    // GETDEL is available on Redis >= 6.2; fall back to a pipeline otherwise.
    if (typeof (this.client as unknown as { getdel?: unknown }).getdel === 'function') {
      return this.client.getdel(key);
    }
    const [[, value]] = (await this.client.multi().get(key).del(key).exec()) as [
      [Error | null, string | null],
      [Error | null, number],
    ];
    return value;
  }

  /**
   * Increment a counter and ensure it expires after `windowSeconds`.
   * Returns the new count and the seconds remaining in the window.
   */
  async incrementWithWindow(
    key: string,
    windowSeconds: number,
  ): Promise<{ count: number; ttl: number }> {
    const results = await this.client.multi().incr(key).ttl(key).exec();
    if (!results) throw new Error('Redis pipeline returned no result');
    const count = results[0][1] as number;
    let ttl = results[1][1] as number;
    if (count === 1 || ttl < 0) {
      await this.client.expire(key, windowSeconds);
      ttl = windowSeconds;
    }
    return { count, ttl };
  }

  async sAdd(key: string, member: string, ttlSeconds: number): Promise<void> {
    await this.client.sadd(key, member);
    await this.client.expire(key, ttlSeconds);
  }

  async sMembers(key: string): Promise<string[]> {
    return this.client.smembers(key);
  }

  async sRem(key: string, member: string): Promise<void> {
    await this.client.srem(key, member);
  }
}
