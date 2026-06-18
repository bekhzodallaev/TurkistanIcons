import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env';
import { IconProcessingProducer } from '../../modules/uploads/icon-processing.producer';
import { BullIconProcessingProducer } from './bull-icon-processing.producer';
import { ICON_PROCESSING_QUEUE, parseRedisConnection } from './queue.constants';

/**
 * Global BullMQ wiring. Provides the icon-processing queue (producer side, used
 * by the API) and binds the IconProcessingProducer token to the BullMQ impl.
 * The worker process imports this too so its @Processor binds the same queue.
 */
@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        connection: parseRedisConnection(config.get('REDIS_URL', { infer: true })),
      }),
    }),
    BullModule.registerQueue({ name: ICON_PROCESSING_QUEUE }),
  ],
  providers: [{ provide: IconProcessingProducer, useClass: BullIconProcessingProducer }],
  exports: [BullModule, IconProcessingProducer],
})
export class QueueModule {}
