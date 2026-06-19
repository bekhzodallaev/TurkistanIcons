import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import type { AuthUser, Role } from '@turkistan/types';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { Env } from '../../../config/env';

interface AccessTokenPayload {
  sub: string;
  role: Role;
  email: string;
}

/**
 * Validates the bearer access JWT and projects its claims into `req.user`.
 * The role comes from the signed token — never from the client. Tokens are
 * short-lived, so a stale role self-heals on the next refresh.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(config: ConfigService<Env, true>) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get('JWT_ACCESS_SECRET', { infer: true }),
    });
  }

  validate(payload: AccessTokenPayload): AuthUser {
    return { id: payload.sub, role: payload.role, email: payload.email };
  }
}
