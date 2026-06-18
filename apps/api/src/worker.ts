import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { initSentry } from './observability/sentry';
import { WorkerModule } from './worker/worker.module';

/**
 * Upload worker entrypoint. Boots a headless Nest context that hosts the BullMQ
 * `icon-processing` consumer (sanitize SVG → render previews → promote → writeback).
 * Runs as a separate process from the HTTP API (see infra/docker).
 */
async function bootstrap(): Promise<void> {
  initSentry();

  const app = await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();

  app.get(Logger).log('Upload worker started; consuming icon-processing jobs', 'WorkerBootstrap');
}

bootstrap().catch((err) => {
  console.error('Fatal: upload worker failed to bootstrap', err);
  process.exit(1);
});
