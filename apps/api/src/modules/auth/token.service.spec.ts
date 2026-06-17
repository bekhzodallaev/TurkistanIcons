import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { AuthUser } from '@turkistan/types';
import type { Env } from '../../config/env';
import type { RedisService } from '../../redis/redis.service';
import { TokenService } from './token.service';

/** Minimal in-memory RedisService double (only the methods TokenService uses). */
function makeFakeRedis(): RedisService {
  const strings = new Map<string, string>();
  const sets = new Map<string, Set<string>>();
  const fake = {
    async setEx(key: string, value: string): Promise<void> {
      strings.set(key, value);
    },
    async get(key: string): Promise<string | null> {
      return strings.get(key) ?? null;
    },
    async del(...keys: string[]): Promise<void> {
      for (const k of keys) {
        strings.delete(k);
        sets.delete(k);
      }
    },
    async sAdd(key: string, member: string): Promise<void> {
      const set = sets.get(key) ?? new Set<string>();
      set.add(member);
      sets.set(key, set);
    },
    async sMembers(key: string): Promise<string[]> {
      return [...(sets.get(key) ?? [])];
    },
    async sRem(key: string, member: string): Promise<void> {
      sets.get(key)?.delete(member);
    },
  };
  return fake as unknown as RedisService;
}

function makeConfig(): ConfigService<Env, true> {
  const values: Partial<Record<keyof Env, string>> = {
    JWT_ACCESS_SECRET: 'a'.repeat(40),
    JWT_REFRESH_SECRET: 'b'.repeat(40),
    JWT_ACCESS_TTL: '15m',
    JWT_REFRESH_TTL: '30d',
  };
  return {
    get: (key: keyof Env) => values[key],
  } as unknown as ConfigService<Env, true>;
}

const principal: AuthUser = { id: 'user-1', role: 'USER', email: 'user1@example.com' };

describe('TokenService', () => {
  let service: TokenService;
  let jwt: JwtService;

  beforeEach(() => {
    jwt = new JwtService({});
    service = new TokenService(jwt, makeFakeRedis(), makeConfig());
  });

  it('signs an access token carrying sub/role/email', async () => {
    const token = await service.signAccessToken(principal);
    const payload = await jwt.verifyAsync<{ sub: string; role: string; email: string }>(token, {
      secret: 'a'.repeat(40),
    });
    expect(payload.sub).toBe('user-1');
    expect(payload.role).toBe('USER');
    expect(payload.email).toBe('user1@example.com');
  });

  it('rotates a refresh token, returning a new one for the same user', async () => {
    const rt1 = await service.createRefreshSession('user-1');
    const { userId, refreshToken: rt2 } = await service.rotateRefreshSession(rt1);
    expect(userId).toBe('user-1');
    expect(rt2).not.toBe(rt1);
  });

  it('detects reuse of an already-rotated token and revokes the whole family', async () => {
    const rt1 = await service.createRefreshSession('user-1');
    const { refreshToken: rt2 } = await service.rotateRefreshSession(rt1);

    // Replaying rt1 (already rotated) is treated as theft.
    await expect(service.rotateRefreshSession(rt1)).rejects.toBeInstanceOf(UnauthorizedException);

    // ...and the family is burned, so even the legitimately-rotated rt2 is dead.
    await expect(service.rotateRefreshSession(rt2)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('invalidates a token after logout (revokeRefreshToken)', async () => {
    const rt1 = await service.createRefreshSession('user-1');
    await service.revokeRefreshToken(rt1);
    await expect(service.rotateRefreshSession(rt1)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('revokes all sessions for a user', async () => {
    const rtA = await service.createRefreshSession('user-1');
    const rtB = await service.createRefreshSession('user-1');
    await service.revokeAllSessions('user-1');
    await expect(service.rotateRefreshSession(rtA)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(service.rotateRefreshSession(rtB)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a token signed with the wrong secret', async () => {
    const forged = await jwt.signAsync(
      { sub: 'user-1', fam: 'x', jti: 'y' },
      { secret: 'wrong-secret', expiresIn: '30d' },
    );
    await expect(service.rotateRefreshSession(forged)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
