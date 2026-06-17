import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { validateEnv } from './config/env';
import { HealthModule } from './health/health.module';
import { MailerModule } from './mailer/mailer.module';
import { AuthModule } from './modules/auth/auth.module';
import { loggerOptions } from './observability/logger';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    LoggerModule.forRoot(loggerOptions),
    PrismaModule,
    RedisModule,
    MailerModule,
    HealthModule,
    AuthModule,
  ],
  providers: [
    // Deny-by-default: every route requires a valid access token (JwtAuthGuard,
    // honoring @Public()) and then passes role checks (RolesGuard). Order in
    // this array is the execution order.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
