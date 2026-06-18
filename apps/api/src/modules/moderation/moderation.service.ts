import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { ModerationQueueItem } from '@turkistan/types';
import { CategoriesService } from '../categories/categories.service';
import { AuditService } from '../audit/audit.service';
import { MailerService } from '../../mailer/mailer.service';
import { PrismaService } from '../../prisma/prisma.service';
import { R2Service } from '../../storage/r2.service';

export interface ModerationResult {
  id: string;
  status: string;
}

/**
 * Admin moderation gate: only PUBLISHED icons become publicly discoverable.
 * Every decision writes a moderation_events row and an audit_log entry
 * (docs/UPLOAD-PIPELINE.md §8, SECURITY.md §3) atomically with the status change.
 */
@Injectable()
export class ModerationService {
  private readonly logger = new Logger(ModerationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly r2: R2Service,
    private readonly mailer: MailerService,
    private readonly audit: AuditService,
    private readonly categories: CategoriesService,
  ) {}

  async queue(limit: number): Promise<ModerationQueueItem[]> {
    const icons = await this.prisma.icon.findMany({
      where: { status: 'PENDING_REVIEW', deletedAt: null },
      orderBy: { updatedAt: 'asc' }, // oldest first (FIFO review)
      take: limit,
      include: { creator: { select: { id: true, slug: true, displayName: true } } },
    });
    return icons.map((icon) => ({
      id: icon.id,
      name: icon.name,
      slug: icon.slug,
      status: icon.status,
      previewUrl: icon.pngKey ? this.r2.publicUrl(icon.pngKey) : null,
      creator: icon.creator,
      createdAt: icon.createdAt.toISOString(),
    }));
  }

  async approve(iconId: string, adminId: string): Promise<ModerationResult> {
    const icon = await this.loadPending(iconId);
    const tagIds = icon.iconTags.map((t) => t.tagId);

    await this.prisma.$transaction(async (tx) => {
      const res = await tx.icon.updateMany({
        where: { id: iconId, status: 'PENDING_REVIEW' },
        data: { status: 'PUBLISHED', publishedAt: new Date() },
      });
      if (res.count === 0) throw new ConflictException('Icon is not pending review');
      // Maintain denormalized counters now that the icon is publicly visible.
      await tx.category.update({
        where: { id: icon.categoryId },
        data: { iconCount: { increment: 1 } },
      });
      if (tagIds.length) {
        await tx.tag.updateMany({ where: { id: { in: tagIds } }, data: { usageCount: { increment: 1 } } });
      }
      await tx.moderationEvent.create({
        data: { iconId, moderatorId: adminId, action: 'APPROVE' },
      });
      await this.audit.recordTx(tx, {
        actorId: adminId,
        action: 'icon.approve',
        entity: 'icon',
        entityId: iconId,
      });
    });

    await this.categories.invalidateTree();
    await this.notify(() => this.mailer.sendIconApproved(icon.creator.user.email, icon.name));
    return { id: iconId, status: 'PUBLISHED' };
  }

  async reject(iconId: string, adminId: string, reason: string): Promise<ModerationResult> {
    const icon = await this.loadPending(iconId);

    await this.prisma.$transaction(async (tx) => {
      const res = await tx.icon.updateMany({
        where: { id: iconId, status: 'PENDING_REVIEW' },
        data: { status: 'REJECTED', rejectionReason: reason },
      });
      if (res.count === 0) throw new ConflictException('Icon is not pending review');
      await tx.moderationEvent.create({
        data: { iconId, moderatorId: adminId, action: 'REJECT', reason },
      });
      await this.audit.recordTx(tx, {
        actorId: adminId,
        action: 'icon.reject',
        entity: 'icon',
        entityId: iconId,
        metadata: { reason },
      });
    });

    await this.notify(() => this.mailer.sendIconRejected(icon.creator.user.email, icon.name, reason));
    return { id: iconId, status: 'REJECTED' };
  }

  async requestChanges(iconId: string, adminId: string, reason: string): Promise<ModerationResult> {
    const icon = await this.loadPending(iconId);

    // Status stays PENDING_REVIEW; we only record the decision + notify.
    await this.prisma.$transaction(async (tx) => {
      await tx.moderationEvent.create({
        data: { iconId, moderatorId: adminId, action: 'REQUEST_CHANGES', reason },
      });
      await this.audit.recordTx(tx, {
        actorId: adminId,
        action: 'icon.request_changes',
        entity: 'icon',
        entityId: iconId,
        metadata: { reason },
      });
    });

    await this.notify(() =>
      this.mailer.sendIconChangesRequested(icon.creator.user.email, icon.name, reason),
    );
    return { id: iconId, status: 'PENDING_REVIEW' };
  }

  private async loadPending(iconId: string) {
    const icon = await this.prisma.icon.findUnique({
      where: { id: iconId },
      include: {
        creator: { select: { user: { select: { email: true } } } },
        iconTags: { select: { tagId: true } },
      },
    });
    if (!icon || icon.deletedAt) throw new NotFoundException('Icon not found');
    if (icon.status !== 'PENDING_REVIEW') {
      throw new ConflictException('Icon is not pending review');
    }
    return icon;
  }

  private async notify(send: () => Promise<void>): Promise<void> {
    try {
      await send();
    } catch (err) {
      this.logger.warn(`Moderation notification email failed: ${(err as Error).message}`);
    }
  }
}
