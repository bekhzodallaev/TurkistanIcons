import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Marks a route (or controller) as publicly accessible, bypassing the global
 * JwtAuthGuard. Authorization is deny-by-default: every route requires a valid
 * access token unless explicitly opted out with `@Public()`.
 */
export const Public = (): MethodDecorator & ClassDecorator =>
  SetMetadata(IS_PUBLIC_KEY, true);
