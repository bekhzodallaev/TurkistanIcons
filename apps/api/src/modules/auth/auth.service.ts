import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type {
  AuthUser,
  ForgotPasswordInput,
  LoginInput,
  PublicUser,
  RegisterInput,
  ResetPasswordInput,
} from '@turkistan/types';
import type { User } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { MailerService } from '../../mailer/mailer.service';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';
import type { GoogleIdentity } from './strategies/google.strategy';

const EMAIL_VERIFICATION_TTL_SECONDS = 24 * 60 * 60;
const PASSWORD_RESET_TTL_SECONDS = 60 * 60;

/** Internal result that carries both the JSON body and the cookie token. */
export interface SessionResult {
  user: PublicUser;
  accessToken: string;
  expiresIn: number;
  /** Set by the controller as an httpOnly cookie (and echoed in the body for non-browser clients). */
  refreshToken: string;
}

export interface MeResult extends PublicUser {
  creator: { id: string; slug: string; displayName: string } | null;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly mailer: MailerService,
    private readonly password: PasswordService,
    private readonly tokens: TokenService,
  ) {}

  async register(input: RegisterInput): Promise<SessionResult> {
    const existing = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }
    const passwordHash = await this.password.hash(input.password);
    const user = await this.prisma.user.create({
      data: { email: input.email, name: input.name, passwordHash, role: 'USER' },
    });
    await this.issueEmailVerification(user.id, user.email);
    return this.issueSession(user);
  }

  async login(input: LoginInput): Promise<SessionResult> {
    const user = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (!user || !user.passwordHash) {
      // Constant-ish time + generic message: no account-existence oracle.
      await this.password.dummyVerify();
      throw new UnauthorizedException('Invalid email or password');
    }
    const ok = await this.password.verify(user.passwordHash, input.password);
    if (!ok) throw new UnauthorizedException('Invalid email or password');
    this.assertActive(user);
    return this.issueSession(user);
  }

  async loginWithGoogle(identity: GoogleIdentity): Promise<SessionResult> {
    let user = await this.prisma.user.findUnique({ where: { googleId: identity.googleId } });

    if (!user) {
      const byEmail = await this.prisma.user.findUnique({ where: { email: identity.email } });
      if (byEmail) {
        // Link to an existing local account only if Google verified the email,
        // which proves ownership and blocks pre-link account takeover.
        if (!identity.emailVerified) {
          throw new ForbiddenException(
            'This email is registered. Verify your email with Google or sign in with your password.',
          );
        }
        user = await this.prisma.user.update({
          where: { id: byEmail.id },
          data: {
            googleId: identity.googleId,
            emailVerifiedAt: byEmail.emailVerifiedAt ?? new Date(),
            avatarUrl: byEmail.avatarUrl ?? identity.avatarUrl,
          },
        });
      } else {
        user = await this.prisma.user.create({
          data: {
            email: identity.email,
            name: identity.name,
            googleId: identity.googleId,
            emailVerifiedAt: identity.emailVerified ? new Date() : null,
            avatarUrl: identity.avatarUrl,
            role: 'USER',
          },
        });
      }
    }

    this.assertActive(user);
    return this.issueSession(user);
  }

  async refresh(refreshToken: string | undefined): Promise<SessionResult> {
    if (!refreshToken) throw new UnauthorizedException('Missing refresh token');
    const { userId, refreshToken: rotated } =
      await this.tokens.rotateRefreshSession(refreshToken);
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      await this.tokens.revokeAllSessions(userId);
      throw new UnauthorizedException('Account no longer exists');
    }
    if (user.status === 'suspended') {
      await this.tokens.revokeAllSessions(userId);
      throw new ForbiddenException('Account suspended');
    }
    const accessToken = await this.tokens.signAccessToken(this.toAuthUser(user));
    return {
      user: this.toPublicUser(user),
      accessToken,
      expiresIn: this.tokens.accessTtlSeconds,
      refreshToken: rotated,
    };
  }

  async logout(refreshToken: string | undefined): Promise<void> {
    if (refreshToken) await this.tokens.revokeRefreshToken(refreshToken);
  }

  async verifyEmail(token: string): Promise<{ verified: true }> {
    const userId = await this.redis.getDel(`auth:verify:${this.password.hashToken(token)}`);
    if (!userId) throw new BadRequestException('Invalid or expired verification token');
    await this.prisma.user.update({
      where: { id: userId },
      data: { emailVerifiedAt: new Date() },
    });
    return { verified: true };
  }

  async resendVerification(email: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (user && !user.emailVerifiedAt) {
      await this.issueEmailVerification(user.id, user.email);
    }
    // Generic success regardless — no account-existence oracle.
  }

  async forgotPassword({ email }: ForgotPasswordInput): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    // Only password-based accounts can reset; OAuth-only accounts have no hash.
    if (user?.passwordHash) {
      const { token, tokenHash } = this.password.generateToken();
      await this.redis.setEx(`auth:pwreset:${tokenHash}`, user.id, PASSWORD_RESET_TTL_SECONDS);
      await this.mailer.sendPasswordReset(email, token);
    }
    // Always generic success.
  }

  async resetPassword({ token, password }: ResetPasswordInput): Promise<void> {
    const userId = await this.redis.getDel(`auth:pwreset:${this.password.hashToken(token)}`);
    if (!userId) throw new BadRequestException('Invalid or expired reset token');
    const passwordHash = await this.password.hash(password);
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } });
    // Invalidate every active session so a stolen session can't outlive the reset.
    await this.tokens.revokeAllSessions(userId);
  }

  async me(userId: string): Promise<MeResult> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { creator: { select: { id: true, slug: true, displayName: true } } },
    });
    if (!user) throw new UnauthorizedException('Account no longer exists');
    return { ...this.toPublicUser(user), creator: user.creator ?? null };
  }

  private async issueSession(user: User): Promise<SessionResult> {
    const accessToken = await this.tokens.signAccessToken(this.toAuthUser(user));
    const refreshToken = await this.tokens.createRefreshSession(user.id);
    return {
      user: this.toPublicUser(user),
      accessToken,
      expiresIn: this.tokens.accessTtlSeconds,
      refreshToken,
    };
  }

  private async issueEmailVerification(userId: string, email: string): Promise<void> {
    const { token, tokenHash } = this.password.generateToken();
    await this.redis.setEx(`auth:verify:${tokenHash}`, userId, EMAIL_VERIFICATION_TTL_SECONDS);
    await this.mailer.sendEmailVerification(email, token);
  }

  private assertActive(user: User): void {
    if (user.status === 'suspended') throw new ForbiddenException('Account suspended');
  }

  private toAuthUser(user: User): AuthUser {
    return { id: user.id, role: user.role, email: user.email };
  }

  private toPublicUser(user: User): PublicUser {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
      role: user.role,
      emailVerifiedAt: user.emailVerifiedAt ? user.emailVerifiedAt.toISOString() : null,
    };
  }
}
