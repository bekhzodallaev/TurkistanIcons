import { Module } from '@nestjs/common';
import { AdminCreatorApplicationsController } from './admin-creator-applications.controller';
import { CreatorApplicationsService } from './creator-applications.service';
import { CreatorDashboardController } from './creator-dashboard.controller';
import { CreatorsController } from './creators.controller';
import { CreatorsService } from './creators.service';

@Module({
  controllers: [
    CreatorsController,
    CreatorDashboardController,
    AdminCreatorApplicationsController,
  ],
  providers: [CreatorsService, CreatorApplicationsService],
  exports: [CreatorsService, CreatorApplicationsService],
})
export class CreatorsModule {}
