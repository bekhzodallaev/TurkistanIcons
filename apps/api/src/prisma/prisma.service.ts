import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Wraps the generated Prisma client as an injectable Nest provider.
 * The web app never talks to Postgres directly — all DB access goes through
 * the API via this service (see CLAUDE.md / docs/ARCHITECTURE.md).
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit(): Promise<void> {
    // Best-effort eager connect for a fast first query and early misconfig
    // signal. Prisma also connects lazily, so a missing DB must not block boot
    // (the API + /health come up without Postgres in dev/CI).
    try {
      await this.$connect();
      this.logger.log('Prisma connected to PostgreSQL');
    } catch (err) {
      this.logger.warn(
        `Prisma could not connect at startup (${(err as Error).message}); will retry lazily on first query`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
