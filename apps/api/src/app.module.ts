import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { validateEnv } from './config/env';
import { QueueModule } from './infra/queue/queue.module';
import { HealthModule } from './health/health.module';
import { MailerModule } from './mailer/mailer.module';
import { AuthModule } from './modules/auth/auth.module';
import { AdminUsersModule } from './modules/admin-users/admin-users.module';
import { AuditModule } from './modules/audit/audit.module';
import { CategoriesModule } from './modules/categories/categories.module';
import { CreatorsModule } from './modules/creators/creators.module';
import { IconsApiModule } from './modules/icons/icons-api.module';
import { ModerationModule } from './modules/moderation/moderation.module';
import { TagsModule } from './modules/tags/tags.module';
import { UploadsModule } from './modules/uploads/uploads.module';
import { loggerOptions } from './observability/logger';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { StorageModule } from './storage/storage.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    LoggerModule.forRoot(loggerOptions),
    PrismaModule,
    RedisModule,
    MailerModule,
    StorageModule,
    QueueModule,
    AuditModule,
    HealthModule,
    AuthModule,
    CategoriesModule,
    TagsModule,
    CreatorsModule,
    UploadsModule,
    IconsApiModule,
    ModerationModule,
    AdminUsersModule,
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
