import { Controller, Get, Param } from '@nestjs/common';
import type { CategoryDetail, CategoryNode } from '@turkistan/types';
import { Public } from '../../common/decorators/public.decorator';
import { CategoriesService } from './categories.service';

/** Public, cache-backed taxonomy reads (VISITOR — no auth). */
@Public()
@Controller({ path: 'categories', version: '1' })
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  /** Full nested category tree from a single cached call. */
  @Get()
  getTree(): Promise<CategoryNode[]> {
    return this.categories.getTree();
  }

  /** Category detail + immediate children. */
  @Get(':slug')
  getBySlug(@Param('slug') slug: string): Promise<CategoryDetail> {
    return this.categories.getBySlug(slug);
  }
}
