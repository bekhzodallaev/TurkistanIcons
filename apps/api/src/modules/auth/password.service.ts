import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'node:crypto';

/**
 * Password hashing (argon2id) and opaque-token generation.
 *
 * - Passwords are hashed with argon2id at OWASP-recommended cost; plaintext is
 *   never stored (docs/SECURITY.md §2).
 * - Email-verification and password-reset tokens are random and **stored
 *   hashed** (sha256). The raw token only ever exists in the email link; a DB/
 *   Redis leak cannot be replayed.
 */
@Injectable()
export class PasswordService {
  private readonly argonOptions: argon2.Options = {
    type: argon2.argon2id,
    memoryCost: 19_456, // 19 MiB
    timeCost: 2,
    parallelism: 1,
  };

  hash(password: string): Promise<string> {
    return argon2.hash(password, this.argonOptions);
  }

  async verify(hash: string, password: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, password);
    } catch {
      // Malformed hash, etc. — treat as a non-match rather than throwing.
      return false;
    }
  }

  /** A constant-cost dummy verify to blunt user-enumeration timing on login. */
  async dummyVerify(): Promise<void> {
    // Pre-computed argon2id hash of a random value; result is ignored.
    await this.verify(
      '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHR2YWx1ZTE2$3m3Y0u0r4S0p7sQwJ5b8nQ2k1xqQ0Zr8wYwq7N0k0A',
      'dummy-password',
    );
  }

  /** Generate a random opaque token and its sha256 hash (store the hash). */
  generateToken(): { token: string; tokenHash: string } {
    const token = randomBytes(32).toString('base64url');
    return { token, tokenHash: this.hashToken(token) };
  }

  hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
