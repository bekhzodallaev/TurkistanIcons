import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  type AdminApplicationDto,
  type AuthUser,
  type CreatorApplicationDto,
  type CreatorRef,
  listApplicationsQuerySchema,
  type ListApplicationsQuery,
  rejectApplicationSchema,
  type RejectApplicationInput,
} from '@turkistan/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CreatorApplicationsService } from './creator-applications.service';

/** Admin review queue for creator applications. */
@Roles('ADMIN')
@Controller({ path: 'admin/creator-applications', version: '1' })
export class AdminCreatorApplicationsController {
  constructor(private readonly applications: CreatorApplicationsService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(listApplicationsQuerySchema)) query: ListApplicationsQuery,
  ): Promise<AdminApplicationDto[]> {
    return this.applications.list(query);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() admin: AuthUser,
  ): Promise<{ application: CreatorApplicationDto; creator: CreatorRef }> {
    return this.applications.approve(id, admin.id);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() admin: AuthUser,
    @Body(new ZodValidationPipe(rejectApplicationSchema)) dto: RejectApplicationInput,
  ): Promise<CreatorApplicationDto> {
    return this.applications.reject(id, admin.id, dto.reviewNote);
  }
}
