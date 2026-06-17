import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  type AuthTokensResponse,
  type AuthUser,
  forgotPasswordSchema,
  type ForgotPasswordInput,
  loginSchema,
  type LoginInput,
  refreshSchema,
  type RefreshInput,
  registerSchema,
  type RegisterInput,
  resendVerificationSchema,
  type ResendVerificationInput,
  resetPasswordSchema,
  type ResetPasswordInput,
  verifyEmailSchema,
  type VerifyEmailInput,
} from '@turkistan/types';
import type { CookieOptions, Request, Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { RateLimit } from '../../common/decorators/rate-limit.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RateLimitGuard } from '../../common/guards/rate-limit.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { Env } from '../../config/env';
import { AuthService, type MeResult, type SessionResult } from './auth.service';
import { GoogleAuthGuard } from './guards/google-auth.guard';
import type { GoogleIdentity } from './strategies/google.strategy';
import { TokenService } from './token.service';

const REFRESH_COOKIE = 'refresh_token';
const REFRESH_COOKIE_PATH = '/api/v1/auth';

@Controller({ path: 'auth', version: '1' })
@UseGuards(RateLimitGuard)
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly tokens: TokenService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @Public()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @RateLimit({ name: 'register', limit: 5, windowSeconds: 60, keyBy: 'ip+email' })
  async register(
    @Body(new ZodValidationPipe(registerSchema)) dto: RegisterInput,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthTokensResponse> {
    return this.completeSession(await this.auth.register(dto), res);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ name: 'login', limit: 5, windowSeconds: 60, keyBy: 'ip+email' })
  async login(
    @Body(new ZodValidationPipe(loginSchema)) dto: LoginInput,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthTokensResponse> {
    return this.completeSession(await this.auth.login(dto), res);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ name: 'refresh', limit: 10, windowSeconds: 60, keyBy: 'ip' })
  async refresh(
    @Body(new ZodValidationPipe(refreshSchema)) dto: RefreshInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthTokensResponse> {
    const token = this.readRefreshToken(req, dto);
    return this.completeSession(await this.auth.refresh(token), res);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Body(new ZodValidationPipe(refreshSchema)) dto: RefreshInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.logout(this.readRefreshToken(req, dto));
    res.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH });
  }

  @Public()
  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ name: 'verify-email', limit: 10, windowSeconds: 60, keyBy: 'ip' })
  verifyEmail(
    @Body(new ZodValidationPipe(verifyEmailSchema)) dto: VerifyEmailInput,
  ): Promise<{ verified: true }> {
    return this.auth.verifyEmail(dto.token);
  }

  @Post('resend-verification')
  @HttpCode(HttpStatus.ACCEPTED)
  @RateLimit({ name: 'resend-verification', limit: 3, windowSeconds: 3600, keyBy: 'ip+email' })
  async resendVerification(
    @Body(new ZodValidationPipe(resendVerificationSchema)) dto: ResendVerificationInput,
  ): Promise<{ status: 'ok' }> {
    await this.auth.resendVerification(dto.email);
    return { status: 'ok' };
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.ACCEPTED)
  @RateLimit({ name: 'forgot-password', limit: 3, windowSeconds: 3600, keyBy: 'ip+email' })
  async forgotPassword(
    @Body(new ZodValidationPipe(forgotPasswordSchema)) dto: ForgotPasswordInput,
  ): Promise<{ status: 'ok' }> {
    await this.auth.forgotPassword(dto);
    return { status: 'ok' };
  }

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ name: 'reset-password', limit: 5, windowSeconds: 3600, keyBy: 'ip' })
  async resetPassword(
    @Body(new ZodValidationPipe(resetPasswordSchema)) dto: ResetPasswordInput,
  ): Promise<{ status: 'ok' }> {
    await this.auth.resetPassword(dto);
    return { status: 'ok' };
  }

  @Get('me')
  @Roles('USER')
  me(@CurrentUser() user: AuthUser): Promise<MeResult> {
    return this.auth.me(user.id);
  }

  // ---- Google OAuth ----

  @Public()
  @Get('google')
  @UseGuards(GoogleAuthGuard)
  // Passport issues the redirect to Google; this body never runs.
  googleStart(): void {}

  @Public()
  @Get('google/callback')
  @UseGuards(GoogleAuthGuard)
  async googleCallback(
    @Req() req: Request & { user?: GoogleIdentity },
    @Res() res: Response,
  ): Promise<void> {
    const session = await this.auth.loginWithGoogle(req.user as GoogleIdentity);
    this.setRefreshCookie(res, session.refreshToken);
    // Hand the access token to the web app via URL fragment (kept out of logs).
    const webUrl = this.config.get('WEB_URL', { infer: true });
    const fragment = `access_token=${encodeURIComponent(session.accessToken)}&expires_in=${session.expiresIn}`;
    res.redirect(`${webUrl}/auth/callback#${fragment}`);
  }

  // ---- helpers ----

  private completeSession(session: SessionResult, res: Response): AuthTokensResponse {
    this.setRefreshCookie(res, session.refreshToken);
    return { user: session.user, accessToken: session.accessToken, expiresIn: session.expiresIn };
  }

  private readRefreshToken(req: Request, dto: RefreshInput): string | undefined {
    const cookies = (req as Request & { cookies?: Record<string, string> }).cookies;
    return cookies?.[REFRESH_COOKIE] ?? dto.refreshToken;
  }

  private setRefreshCookie(res: Response, refreshToken: string): void {
    res.cookie(REFRESH_COOKIE, refreshToken, this.refreshCookieOptions());
  }

  private refreshCookieOptions(): CookieOptions {
    const isProd = this.config.get('NODE_ENV', { infer: true }) === 'production';
    const secureOverride = this.config.get('COOKIE_SECURE', { infer: true });
    const domain = this.config.get('COOKIE_DOMAIN', { infer: true });
    return {
      httpOnly: true,
      sameSite: 'lax',
      secure: secureOverride ?? isProd,
      domain,
      path: REFRESH_COOKIE_PATH,
      maxAge: this.tokens.refreshTtlSeconds * 1000,
    };
  }
}
