import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { type Profile, Strategy, type VerifyCallback } from 'passport-google-oauth20';
import type { Env } from '../../../config/env';

/** Normalized identity extracted from a verified Google profile. */
export interface GoogleIdentity {
  googleId: string;
  email: string;
  emailVerified: boolean;
  name: string;
  avatarUrl: string | null;
}

/**
 * Google OAuth2 strategy. Only registered when GOOGLE_CLIENT_ID/SECRET are set
 * (see AuthModule). Account linking happens in AuthService and only when Google
 * asserts the email is verified, to prevent OAuth pre-link account takeover
 * (docs/SECURITY.md §2).
 */
@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(config: ConfigService<Env, true>) {
    super({
      clientID: config.getOrThrow('GOOGLE_CLIENT_ID', { infer: true }),
      clientSecret: config.getOrThrow('GOOGLE_CLIENT_SECRET', { infer: true }),
      callbackURL: config.get('GOOGLE_CALLBACK_URL', { infer: true }),
      scope: ['email', 'profile'],
    });
  }

  validate(
    _accessToken: string,
    _refreshToken: string,
    profile: Profile,
    done: VerifyCallback,
  ): void {
    const primary = profile.emails?.[0];
    const json = profile._json as { email_verified?: boolean } | undefined;
    if (!primary?.value) {
      done(new Error('Google account has no email'), undefined);
      return;
    }
    const identity: GoogleIdentity = {
      googleId: profile.id,
      email: primary.value.toLowerCase(),
      // passport-google-oauth20 surfaces verification via the raw `_json`.
      emailVerified: json?.email_verified ?? false,
      name: profile.displayName || primary.value,
      avatarUrl: profile.photos?.[0]?.value ?? null,
    };
    done(null, identity);
  }
}
