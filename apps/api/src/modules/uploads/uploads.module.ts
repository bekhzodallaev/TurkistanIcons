import { Module } from '@nestjs/common';
import { IconsModule } from '../icons/icons.module';
import {
  IconProcessingProducer,
  LoggingIconProcessingProducer,
} from './icon-processing.producer';
import { SvgSanitizerService } from './svg-sanitizer.service';
import { UploadsController } from './uploads.controller';
import { UploadsService } from './uploads.service';

@Module({
  imports: [IconsModule],
  controllers: [UploadsController],
  providers: [
    UploadsService,
    SvgSanitizerService,
    // M5a: no-op producer. M5b swaps this binding for the BullMQ producer.
    { provide: IconProcessingProducer, useClass: LoggingIconProcessingProducer },
  ],
  exports: [SvgSanitizerService],
})
export class UploadsModule {}
