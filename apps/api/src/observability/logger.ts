import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Params } from 'nestjs-pino';

const isProd = process.env.NODE_ENV === 'production';

/**
 * Structured JSON logging with a per-request `requestId`.
 * - Honors an inbound `x-request-id` (set by Cloudflare/LB) or mints a UUID.
 * - Echoes the id back on the response so clients/logs can correlate.
 * - Pretty-prints in dev only; emits raw JSON in production.
 */
export const loggerOptions: Params = {
  pinoHttp: {
    level: process.env.LOG_LEVEL ?? 'info',
    genReqId: (req: IncomingMessage, res: ServerResponse) => {
      const header = req.headers['x-request-id'];
      const id = (Array.isArray(header) ? header[0] : header) ?? randomUUID();
      res.setHeader('x-request-id', id);
      return id;
    },
    customProps: (req) => ({ requestId: (req as IncomingMessage & { id?: string }).id }),
    redact: {
      paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
      remove: true,
    },
    transport: isProd
      ? undefined
      : {
          target: 'pino-pretty',
          options: { singleLine: true, translateTime: 'SYS:HH:MM:ss' },
        },
  },
};
