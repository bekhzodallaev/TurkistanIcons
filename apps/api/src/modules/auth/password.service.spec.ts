import { PasswordService } from './password.service';

describe('PasswordService', () => {
  const service = new PasswordService();

  it('hashes and verifies a password (argon2id)', async () => {
    const hash = await service.hash('S0meStr0ng!pass');
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(await service.verify(hash, 'S0meStr0ng!pass')).toBe(true);
  });

  it('rejects an incorrect password', async () => {
    const hash = await service.hash('correct-horse-1');
    expect(await service.verify(hash, 'wrong-password-1')).toBe(false);
  });

  it('returns false (not throw) on a malformed hash', async () => {
    expect(await service.verify('not-a-hash', 'whatever')).toBe(false);
  });

  it('generates a random token and a deterministic sha256 of it', () => {
    const { token, tokenHash } = service.generateToken();
    expect(token).toHaveLength(43); // 32 random bytes, base64url
    expect(tokenHash).toBe(service.hashToken(token));
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces a different token each call', () => {
    expect(service.generateToken().token).not.toBe(service.generateToken().token);
  });
});
