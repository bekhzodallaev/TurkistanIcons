import { SetMetadata } from '@nestjs/common';
import type { Role } from '@turkistan/types';

export const ROLES_KEY = 'roles';

/**
 * Declares the minimum role(s) required for a route. Read by RolesGuard, which
 * is hierarchy-aware (`VISITOR < USER < CREATOR < ADMIN`) — `@Roles('CREATOR')`
 * also admits ADMIN. With no `@Roles`, a route only requires authentication.
 */
export const Roles = (...roles: Role[]): MethodDecorator & ClassDecorator =>
  SetMetadata(ROLES_KEY, roles);
