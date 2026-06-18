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
  type AuthUser,
  listModerationQuerySchema,
  type ListModerationQuery,
  type ModerationQueueItem,
  moderationReasonSchema,
  type ModerationReasonInput,
} from '@turkistan/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ModerationService, type ModerationResult } from './moderation.service';

/** Admin moderation queue + decisions. */
@Roles('ADMIN')
@Controller({ path: 'admin/moderation', version: '1' })
export class ModerationController {
  constructor(private readonly moderation: ModerationService) {}

  @Get('queue')
  queue(
    @Query(new ZodValidationPipe(listModerationQuerySchema)) query: ListModerationQuery,
  ): Promise<ModerationQueueItem[]> {
    return this.moderation.queue(query.limit);
  }

  @Post(':iconId/approve')
  @HttpCode(HttpStatus.OK)
  approve(
    @Param('iconId', ParseUUIDPipe) iconId: string,
    @CurrentUser() admin: AuthUser,
  ): Promise<ModerationResult> {
    return this.moderation.approve(iconId, admin.id);
  }

  @Post(':iconId/reject')
  @HttpCode(HttpStatus.OK)
  reject(
    @Param('iconId', ParseUUIDPipe) iconId: string,
    @CurrentUser() admin: AuthUser,
    @Body(new ZodValidationPipe(moderationReasonSchema)) dto: ModerationReasonInput,
  ): Promise<ModerationResult> {
    return this.moderation.reject(iconId, admin.id, dto.reason);
  }

  @Post(':iconId/request-changes')
  @HttpCode(HttpStatus.OK)
  requestChanges(
    @Param('iconId', ParseUUIDPipe) iconId: string,
    @CurrentUser() admin: AuthUser,
    @Body(new ZodValidationPipe(moderationReasonSchema)) dto: ModerationReasonInput,
  ): Promise<ModerationResult> {
    return this.moderation.requestChanges(iconId, admin.id, dto.reason);
  }
}
