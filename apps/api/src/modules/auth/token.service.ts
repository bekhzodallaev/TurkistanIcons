import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { AuthUser } from '@turkistan/types';
import { randomUUID } from 'node:crypto';
import type { Env } from '../../config/env';
import { ttlToSeconds } from '../../common/util/ttl.util';
import { RedisService } from '../../redis/redis.service';

interface AccessPayload {
  sub: string;
  role: AuthUser['role'];
  email: string;
}

interface RefreshPayload {
  sub: string;
  /** Token family id — the unit of rotation/revocation. */
  fam: string;
  /** This token's id within the family. */
  jti: string;
}

/**
 * JWT issuance + rotating refresh-token sessions.
 *
 * Refresh tokens are stored as families in Redis (docs/DATABASE.md, SECURITY.md
 * §2). Each family tracks the single currently-valid token id. Presenting an
 * old (already-rotated) token of a live family is treated as theft: the whole
 * family is revoked, forcing re-login. Access tokens are stateless and short.
 */
@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name);
  private readonly accessSecret: string;
  private readonly refreshSecret: string;
  private readonly accessTtl: string;
  private readonly refreshTtl: string;
  readonly accessTtlSeconds: number;
  readonly refreshTtlSeconds: number;

  constructor(
    private readonly jwt: JwtService,
    private readonly redis: RedisService,
    config: ConfigService<Env, true>,
  ) {
    this.accessSecret = config.get('JWT_ACCESS_SECRET', { infer: true });
    this.refreshSecret = config.get('JWT_REFRESH_SECRET', { infer: true });
    this.accessTtl = config.get('JWT_ACCESS_TTL', { infer: true });
    this.refreshTtl = config.get('JWT_REFRESH_TTL', { infer: true });
    this.accessTtlSeconds = ttlToSeconds(this.accessTtl);
    this.refreshTtlSeconds = ttlToSeconds(this.refreshTtl);
  }

  private familyKey(userId: string, familyId: string): string {
    return `auth:rt:${userId}:${familyId}`;
  }

  private familySetKey(userId: string): string {
    return `auth:rtfam:${userId}`;
  }

  signAccessToken(user: AuthUser): Promise<string> {
    const payload: Omit<AccessPayload, 'sub'> = { role: user.role, email: user.email };
    return this.jwt.signAsync(payload, {
      secret: this.accessSecret,
      expiresIn: this.accessTtl,
      subject: user.id,
    });
  }

  /** Start a brand-new refresh session (login / register / oauth). */
  async createRefreshSession(userId: string): Promise<string> {
    const familyId = randomUUID();
    const tokenId = randomUUID();
    await this.redis.setEx(this.familyKey(userId, familyId), tokenId, this.refreshTtlSeconds);
    await this.redis.sAdd(this.familySetKey(userId), familyId, this.refreshTtlSeconds);
    return this.signRefreshToken({ sub: userId, fam: familyId, jti: tokenId });
  }

  /**
   * Rotate a presented refresh token. Returns the owning userId and a freshly
   * issued refresh token. Detects and punishes token reuse.
   */
  async rotateRefreshSession(
    refreshToken: string,
  ): Promise<{ userId: string; refreshToken: string }> {
    const payload = await this.verifyRefreshToken(refreshToken);
    const { sub: userId, fam: familyId, jti: tokenId } = payload;

    const current = await this.redis.get(this.familyKey(userId, familyId));
    if (!current) {
      throw new UnauthorizedException('Refresh token is no longer valid');
    }
    if (current !== tokenId) {
      // Replay of an already-rotated token → likely theft. Burn the family.
      this.logger.warn(`Refresh token reuse detected for user ${userId}; revoking family`);
      await this.revokeFamily(userId, familyId);
      throw new UnauthorizedException('Refresh token reuse detected');
    }

    const newTokenId = randomUUID();
    await this.redis.setEx(this.familyKey(userId, familyId), newTokenId, this.refreshTtlSeconds);
    await this.redis.sAdd(this.familySetKey(userId), familyId, this.refreshTtlSeconds);
    const rotated = await this.signRefreshToken({ sub: userId, fam: familyId, jti: newTokenId });
    return { userId, refreshToken: rotated };
  }

  /** Revoke the family that a presented refresh token belongs to (logout). */
  async revokeRefreshToken(refreshToken: string): Promise<void> {
    let payload: RefreshPayload;
    try {
      payload = await this.verifyRefreshToken(refreshToken);
    } catch {
      // Already invalid/expired — nothing to revoke.
      return;
    }
    await this.revokeFamily(payload.sub, payload.fam);
  }

  async revokeFamily(userId: string, familyId: string): Promise<void> {
    await this.redis.del(this.familyKey(userId, familyId));
    await this.redis.sRem(this.familySetKey(userId), familyId);
  }

  /** Revoke every refresh session for a user ("sign out all devices"). */
  async revokeAllSessions(userId: string): Promise<void> {
    const families = await this.redis.sMembers(this.familySetKey(userId));
    const keys = families.map((fam) => this.familyKey(userId, fam));
    if (keys.length) await this.redis.del(...keys);
    await this.redis.del(this.familySetKey(userId));
  }

  private signRefreshToken(payload: RefreshPayload): Promise<string> {
    return this.jwt.signAsync(payload, {
      secret: this.refreshSecret,
      expiresIn: this.refreshTtl,
    });
  }

  private async verifyRefreshToken(token: string): Promise<RefreshPayload> {
    try {
      return await this.jwt.verifyAsync<RefreshPayload>(token, {
        secret: this.refreshSecret,
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
  }
}
