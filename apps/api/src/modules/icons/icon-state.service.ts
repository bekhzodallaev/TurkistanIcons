import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { IconStatus, UploadRejectionReason } from '@turkistan/types';
import type { Icon, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export type OwnedIcon = Prisma.IconGetPayload<{
  include: { creator: { select: { userId: true } } };
}>;

/** Legal IconStatus transitions (docs/UPLOAD-PIPELINE.md §3). */
const ALLOWED_TRANSITIONS: Record<IconStatus, IconStatus[]> = {
  DRAFT: ['PROCESSING', 'REJECTED'],
  PROCESSING: ['PENDING_REVIEW', 'REJECTED'],
  PENDING_REVIEW: ['PUBLISHED', 'REJECTED', 'PENDING_REVIEW'],
  PUBLISHED: ['ARCHIVED', 'REJECTED'],
  REJECTED: ['ARCHIVED'],
  ARCHIVED: [],
};

export interface CreateDraftParams {
  creatorId: string;
  name: string;
  slug: string;
  categoryId: string;
  priceType: 'FREE' | 'PREMIUM';
  priceCents: number;
  license: Icon['license'];
  svgRawKey: string;
  tagIds: string[];
}

export interface CompleteProcessingParams {
  svgKey: string;
  pngKey: string;
  thumbKey: string;
  width: number;
  height: number;
  fileSize: number;
  checksum: string;
}

/**
 * Single guard for all icon status changes — illegal transitions throw and are
 * never persisted. Status updates are conditional on the current status
 * (`WHERE status = from`) so concurrent/duplicate completions are no-ops.
 */
@Injectable()
export class IconStateService {
  constructor(private readonly prisma: PrismaService) {}

  async createDraft(params: CreateDraftParams): Promise<Icon> {
    return this.prisma.icon.create({
      data: {
        creatorId: params.creatorId,
        name: params.name,
        slug: params.slug,
        categoryId: params.categoryId,
        priceType: params.priceType,
        priceCents: params.priceCents,
        license: params.license,
        svgRawKey: params.svgRawKey,
        status: 'DRAFT',
        iconTags: { create: params.tagIds.map((tagId) => ({ tagId })) },
      },
    });
  }

  async findOwned(iconId: string, userId: string): Promise<OwnedIcon> {
    const icon = await this.prisma.icon.findUnique({
      where: { id: iconId },
      include: { creator: { select: { userId: true } } },
    });
    if (!icon || icon.deletedAt) throw new NotFoundException('Icon not found');
    if (icon.creator.userId !== userId) {
      throw new ForbiddenException('You do not own this icon');
    }
    return icon;
  }

  /**
   * Move an icon from `from` to `to`, applying `data`. Throws on an illegal
   * transition (bad pair) or a stale one (row no longer in `from`).
   */
  async transition(
    iconId: string,
    from: IconStatus,
    to: IconStatus,
    data: Prisma.IconUpdateManyMutationInput = {},
  ): Promise<void> {
    if (!ALLOWED_TRANSITIONS[from].includes(to)) {
      throw new ConflictException(`Illegal status transition ${from} → ${to}`);
    }
    const res = await this.prisma.icon.updateMany({
      where: { id: iconId, status: from },
      data: { status: to, ...data },
    });
    if (res.count === 0) {
      throw new ConflictException('Icon is not in the expected state');
    }
  }

  /** Current status of an icon (worker idempotency guard); null if missing. */
  async currentStatus(iconId: string): Promise<IconStatus | null> {
    const icon = await this.prisma.icon.findUnique({
      where: { id: iconId },
      select: { status: true },
    });
    return icon?.status ?? null;
  }

  findPublishedByChecksum(creatorId: string, checksum: string): Promise<Icon | null> {
    return this.prisma.icon.findFirst({
      where: { creatorId, checksum, status: 'PUBLISHED', deletedAt: null },
    });
  }

  /** Worker success path (PROCESSING → PENDING_REVIEW). Idempotent by status. */
  completeProcessing(iconId: string, params: CompleteProcessingParams): Promise<void> {
    return this.transition(iconId, 'PROCESSING', 'PENDING_REVIEW', {
      svgKey: params.svgKey,
      pngKey: params.pngKey,
      thumbKey: params.thumbKey,
      width: params.width,
      height: params.height,
      fileSize: params.fileSize,
      checksum: params.checksum,
    });
  }

  /** Terminal failure path → REJECTED with a machine-readable reason. */
  async failProcessing(iconId: string, reason: UploadRejectionReason): Promise<void> {
    await this.prisma.icon.updateMany({
      where: { id: iconId, status: { in: ['DRAFT', 'PROCESSING'] } },
      data: { status: 'REJECTED', rejectionReason: reason },
    });
  }
}
