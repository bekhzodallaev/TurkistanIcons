import { Module, type Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import type { Env } from '../../config/env';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { GoogleAuthGuard } from './guards/google-auth.guard';
import { PasswordService } from './password.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { GoogleStrategy } from './strategies/google.strategy';
import { TokenService } from './token.service';

/**
 * Registers GoogleStrategy only when credentials are configured. The factory
 * runs after ConfigModule has loaded env, so it reflects runtime config rather
 * than import-time process.env (which would be empty for .env-sourced values).
 * passport-google-oauth20 throws on a missing clientID, so we must not construct
 * it when unconfigured.
 */
const googleStrategyProvider: Provider = {
  provide: GoogleStrategy,
  useFactory: (config: ConfigService<Env, true>) =>
    config.get('GOOGLE_CLIENT_ID', { infer: true }) ? new GoogleStrategy(config) : null,
  inject: [ConfigService],
};

@Module({
  imports: [PassportModule, JwtModule.register({})],
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordService,
    TokenService,
    JwtStrategy,
    GoogleAuthGuard,
    googleStrategyProvider,
  ],
  exports: [TokenService],
})
export class AuthModule {}
