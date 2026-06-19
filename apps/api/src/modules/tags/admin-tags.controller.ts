import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import {
  createTagSchema,
  type CreateTagInput,
  type TagDto,
  updateTagSchema,
  type UpdateTagInput,
} from '@turkistan/types';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { TagsService } from './tags.service';

/** Admin tag management. */
@Roles('ADMIN')
@Controller({ path: 'admin/tags', version: '1' })
export class AdminTagsController {
  constructor(private readonly tags: TagsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body(new ZodValidationPipe(createTagSchema)) dto: CreateTagInput): Promise<TagDto> {
    return this.tags.create(dto);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateTagSchema)) dto: UpdateTagInput,
  ): Promise<TagDto> {
    return this.tags.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.tags.remove(id);
  }
}
