import {
  type ExecutionContext,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthGuard } from '@nestjs/passport';
import type { Env } from '../../../config/env';

/**
 * Triggers the Google OAuth flow. Returns 503 when Google credentials are not
 * configured so the route degrades gracefully instead of throwing an opaque 500.
 */
@Injectable()
export class GoogleAuthGuard extends AuthGuard('google') {
  private readonly enabled: boolean;

  constructor(config: ConfigService<Env, true>) {
    super();
    this.enabled = Boolean(config.get('GOOGLE_CLIENT_ID', { infer: true }));
  }

  canActivate(ctx: ExecutionContext) {
    if (!this.enabled) {
      throw new ServiceUnavailableException('Google sign-in is not configured');
    }
    return super.canActivate(ctx);
  }
}
