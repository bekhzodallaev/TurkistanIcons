import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { validateEnv } from '../config/env';
import { QueueModule } from '../infra/queue/queue.module';
import { IconsModule } from '../modules/icons/icons.module';
import { PreviewRendererService } from '../modules/uploads/preview-renderer.service';
import { SvgSanitizerService } from '../modules/uploads/svg-sanitizer.service';
import { loggerOptions } from '../observability/logger';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { StorageModule } from '../storage/storage.module';
import { IconProcessingProcessor } from './icon-processing.processor';

/**
 * Root module for the upload worker process (no HTTP). Hosts the BullMQ
 * consumer and the sanitize/render services it depends on.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    LoggerModule.forRoot(loggerOptions),
    PrismaModule,
    RedisModule,
    StorageModule,
    QueueModule,
    IconsModule,
  ],
  providers: [SvgSanitizerService, PreviewRendererService, IconProcessingProcessor],
})
export class WorkerModule {}
