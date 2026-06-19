import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AuthUser } from '@turkistan/types';
import type { Request } from 'express';

/**
 * Injects the authenticated principal (`{ id, role, email }`) attached by
 * JwtAuthGuard. On `@Public()` routes with no token, this is `undefined`.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser | undefined => {
    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    return req.user;
  },
);
