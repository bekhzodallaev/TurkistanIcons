import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
} from '@nestjs/common';
import {
  type AdminUserDto,
  type AuthUser,
  listUsersQuerySchema,
  type ListUsersQuery,
  updateUserSchema,
  type UpdateUserInput,
} from '@turkistan/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AdminUsersService } from './admin-users.service';

/** Admin user management — list/inspect users, change role, suspend/reactivate. */
@Roles('ADMIN')
@Controller({ path: 'admin/users', version: '1' })
export class AdminUsersController {
  constructor(private readonly users: AdminUsersService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(listUsersQuerySchema)) query: ListUsersQuery,
  ): Promise<AdminUserDto[]> {
    return this.users.list(query);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<AdminUserDto> {
    return this.users.get(id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() admin: AuthUser,
    @Body(new ZodValidationPipe(updateUserSchema)) dto: UpdateUserInput,
  ): Promise<AdminUserDto> {
    return this.users.update(id, admin.id, dto);
  }
}
