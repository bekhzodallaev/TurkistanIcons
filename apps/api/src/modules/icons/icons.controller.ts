import { Body, Controller, Param, ParseUUIDPipe, Patch } from '@nestjs/common';
import {
  type AuthUser,
  type IconMetadataDto,
  updateIconMetadataSchema,
  type UpdateIconMetadataInput,
} from '@turkistan/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { IconsService } from './icons.service';

/** Creator-owned icon metadata editing (ownership enforced in the service). */
@Roles('CREATOR')
@Controller({ path: 'icons', version: '1' })
export class IconsController {
  constructor(private readonly icons: IconsService) {}

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(updateIconMetadataSchema)) dto: UpdateIconMetadataInput,
  ): Promise<IconMetadataDto> {
    return this.icons.updateMetadata(id, user.id, dto);
  }
}
