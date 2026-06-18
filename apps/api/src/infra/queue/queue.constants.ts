export const ICON_PROCESSING_QUEUE = 'icon-processing';
export const ICON_PROCESSING_JOB = 'process';

/** Parse a redis:// URL into BullMQ connection options. */
export function parseRedisConnection(url: string): {
  host: string;
  port: number;
  username?: string;
  password?: string;
  db?: number;
  maxRetriesPerRequest: null;
} {
  const parsed = new URL(url);
  const db = parsed.pathname && parsed.pathname.length > 1 ? Number(parsed.pathname.slice(1)) : undefined;
  return {
    host: parsed.hostname || '127.0.0.1',
    port: parsed.port ? Number(parsed.port) : 6379,
    username: parsed.username || undefined,
    password: parsed.password || undefined,
    db: Number.isFinite(db) ? db : undefined,
    // BullMQ requires this to be null on its connection.
    maxRetriesPerRequest: null,
  };
}
