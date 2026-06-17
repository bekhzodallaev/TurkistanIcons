import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { type AuthUser, hasAtLeastRole, type Role } from '@turkistan/types';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ROLES_KEY } from '../decorators/roles.decorator';

/**
 * Global authorization guard. Reads `@Roles(...)` metadata and checks the
 * authenticated user's role against the hierarchy (`VISITOR < USER < CREATOR <
 * ADMIN`). A route with no `@Roles` only requires authentication (enforced by
 * JwtAuthGuard, which runs first). Role is taken from the verified JWT — never
 * from the client.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!required?.length) return true;

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const { user } = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    if (!user) throw new ForbiddenException('Authentication required');

    const allowed = required.some((role) => hasAtLeastRole(user.role, role));
    if (!allowed) {
      throw new ForbiddenException('You do not have permission to access this resource');
    }
    return true;
  }
}
