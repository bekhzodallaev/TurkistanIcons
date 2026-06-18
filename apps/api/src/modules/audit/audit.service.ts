import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface AuditEntry {
  actorId: string | null;
  action: string;
  entity: string;
  entityId: string;
  metadata?: Prisma.InputJsonValue;
}

/**
 * Append-only admin/security trail (audit_log). Every admin mutation records who
 * did what to which entity (docs/SECURITY.md §3). The `ip` column is an
 * Unsupported inet type populated by request context in M11; left null here.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  record(entry: AuditEntry): Promise<unknown> {
    return this.prisma.auditLog.create({
      data: {
        actorId: entry.actorId,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId,
        metadata: entry.metadata,
      },
    });
  }

  /** Record within an existing transaction (keeps audit atomic with the action). */
  recordTx(tx: Prisma.TransactionClient, entry: AuditEntry): Promise<unknown> {
    return tx.auditLog.create({
      data: {
        actorId: entry.actorId,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId,
        metadata: entry.metadata,
      },
    });
  }
}
