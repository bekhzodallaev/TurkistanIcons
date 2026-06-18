import { Module } from '@nestjs/common';
import { IconsController } from './icons.controller';
import { IconsModule } from './icons.module';
import { IconsService } from './icons.service';

/**
 * HTTP surface for icons (metadata editor). Kept separate from IconsModule so
 * the worker can import the state machine (IconsModule) without HTTP controllers.
 */
@Module({
  imports: [IconsModule],
  controllers: [IconsController],
  providers: [IconsService],
})
export class IconsApiModule {}
