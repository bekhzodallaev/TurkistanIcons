import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
} from '@nestjs/common';
import {
  applyCreatorSchema,
  type ApplyCreatorInput,
  type CreatorApplicationDto,
  type CreatorDashboard,
  type CreatorIconSummary,
  listCreatorIconsQuerySchema,
  type ListCreatorIconsQuery,
} from '@turkistan/types';
import type { AuthUser } from '@turkistan/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CreatorApplicationsService } from './creator-applications.service';
import { CreatorsService } from './creators.service';

/**
 * Creator self-service. Applying requires only USER; the dashboard requires
 * CREATOR. All routes are scoped to the calling user.
 */
@Controller({ path: 'creator', version: '1' })
export class CreatorDashboardController {
  constructor(
    private readonly applications: CreatorApplicationsService,
    private readonly creators: CreatorsService,
  ) {}

  @Post('apply')
  @Roles('USER')
  @HttpCode(HttpStatus.CREATED)
  apply(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(applyCreatorSchema)) dto: ApplyCreatorInput,
  ): Promise<CreatorApplicationDto> {
    return this.applications.apply(user.id, dto);
  }

  @Get('application')
  @Roles('USER')
  getOwnApplication(@CurrentUser() user: AuthUser): Promise<CreatorApplicationDto> {
    return this.applications.getOwnLatest(user.id);
  }

  @Get('dashboard')
  @Roles('CREATOR')
  getDashboard(@CurrentUser() user: AuthUser): Promise<CreatorDashboard> {
    return this.creators.getDashboard(user.id);
  }

  @Get('icons')
  @Roles('CREATOR')
  listOwnIcons(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(listCreatorIconsQuerySchema)) query: ListCreatorIconsQuery,
  ): Promise<CreatorIconSummary[]> {
    return this.creators.listOwnIcons(user.id, query);
  }
}
