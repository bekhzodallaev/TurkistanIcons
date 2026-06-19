import 'reflect-metadata';
import { RequestMethod, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { ProblemDetailsFilter } from './common/problem-details.filter';
import { initSentry } from './observability/sentry';

async function bootstrap(): Promise<void> {
  initSentry();

  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  // Use pino for all framework logs (structured JSON + request ids).
  app.useLogger(app.get(Logger));

  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({
    origin: process.env.WEB_URL ?? 'http://localhost:3000',
    credentials: true,
  });

  // Health probes live at the root; everything else is under /api/v1.
  app.setGlobalPrefix('api', {
    exclude: [
      { path: 'health', method: RequestMethod.GET },
      { path: 'health/live', method: RequestMethod.GET },
    ],
  });
  // URI versioning → /api/v1/... (HealthController opts out via VERSION_NEUTRAL).
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  // NOTE: request-body validation is done with zod pipes at the edges
  // (see packages/types + M2), not Nest's class-validator ValidationPipe.
  app.useGlobalFilters(new ProblemDetailsFilter());

  app.enableShutdownHooks();

  const port = Number(process.env.API_PORT ?? 4000);
  await app.listen(port, '0.0.0.0');

  const logger = app.get(Logger);
  logger.log(`API listening on http://0.0.0.0:${port} (health at /health)`, 'Bootstrap');
}

bootstrap().catch((err) => {
  // Surface fatal startup errors clearly; nothing should be swallowed.
  console.error('Fatal: API failed to bootstrap', err);
  process.exit(1);
});
