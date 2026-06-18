import { Module } from '@nestjs/common';
import { IconStateService } from './icon-state.service';

/**
 * Shared icon state machine. Imported by the upload API (M5a) and, later, the
 * processing worker (M5b) so both go through the same transition guard.
 */
@Module({
  providers: [IconStateService],
  exports: [IconStateService],
})
export class IconsModule {}
