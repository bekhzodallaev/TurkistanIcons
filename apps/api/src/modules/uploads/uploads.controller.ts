import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  type AuthUser,
  uploadInitSchema,
  type UploadInitInput,
  type UploadInitResponse,
  type UploadStatusDto,
} from '@turkistan/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RateLimit } from '../../common/decorators/rate-limit.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RateLimitGuard } from '../../common/guards/rate-limit.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { UploadsService } from './uploads.service';

/**
 * Creator upload flow (signed-PUT). All routes require CREATOR; finalize/status
 * additionally enforce per-icon ownership in the service. See docs/API.md §13.
 */
@Roles('CREATOR')
@UseGuards(RateLimitGuard)
@Controller({ path: 'uploads', version: '1' })
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  @Post('init')
  @HttpCode(HttpStatus.CREATED)
  @RateLimit({ name: 'upload-init', limit: 30, windowSeconds: 60, keyBy: 'user' })
  init(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(uploadInitSchema)) dto: UploadInitInput,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<UploadInitResponse> {
    if (!idempotencyKey || idempotencyKey.trim().length === 0) {
      throw new BadRequestException('Idempotency-Key header is required');
    }
    return this.uploads.init(user.id, dto, idempotencyKey.trim());
  }

  @Post(':id/finalize')
  @HttpCode(HttpStatus.ACCEPTED)
  @RateLimit({ name: 'upload-finalize', limit: 60, windowSeconds: 60, keyBy: 'user' })
  finalize(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<{ id: string; status: string }> {
    return this.uploads.finalize(id, user.id);
  }

  @Get(':id/status')
  status(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<UploadStatusDto> {
    return this.uploads.status(id, user.id);
  }
}
