import { Controller, Get, Param, Query } from '@nestjs/common';
import { type PublicCreatorProfile, z } from '@turkistan/types';
import { Public } from '../../common/decorators/public.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CreatorsService } from './creators.service';

const listCreatorsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
type ListCreatorsQuery = z.infer<typeof listCreatorsQuerySchema>;

/** Public creator profiles (VISITOR — no auth). Cursor browse arrives in M7. */
@Public()
@Controller({ path: 'creators', version: '1' })
export class CreatorsController {
  constructor(private readonly creators: CreatorsService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(listCreatorsQuerySchema)) query: ListCreatorsQuery,
  ): Promise<PublicCreatorProfile[]> {
    return this.creators.list(query.limit);
  }

  @Get(':slug')
  getBySlug(@Param('slug') slug: string): Promise<PublicCreatorProfile> {
    return this.creators.getPublicProfile(slug);
  }
}
