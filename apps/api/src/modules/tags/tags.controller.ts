import { Controller, Get, Query } from '@nestjs/common';
import { type ListTagsQuery, listTagsQuerySchema, type TagDto } from '@turkistan/types';
import { Public } from '../../common/decorators/public.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { TagsService } from './tags.service';

/** Public tag listing (VISITOR — no auth). Supports `q` prefix + `sort`. */
@Public()
@Controller({ path: 'tags', version: '1' })
export class TagsController {
  constructor(private readonly tags: TagsService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(listTagsQuerySchema)) query: ListTagsQuery,
  ): Promise<TagDto[]> {
    return this.tags.list(query);
  }
}
