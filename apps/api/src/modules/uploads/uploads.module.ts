import { Module } from '@nestjs/common';
import { IconsModule } from '../icons/icons.module';
import { SvgSanitizerService } from './svg-sanitizer.service';
import { UploadsController } from './uploads.controller';
import { UploadsService } from './uploads.service';

/**
 * Upload API. The IconProcessingProducer is provided globally by QueueModule
 * (BullMQ) since M5b — finalize enqueues real jobs consumed by the worker.
 */
@Module({
  imports: [IconsModule],
  controllers: [UploadsController],
  providers: [UploadsService, SvgSanitizerService],
  exports: [SvgSanitizerService],
})
export class UploadsModule {}
