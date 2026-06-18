import { Injectable, NotFoundException } from '@nestjs/common';
import {
  type CreatorDashboard,
  type CreatorIconSummary,
  ICON_STATUSES,
  type IconStatus,
  type ListCreatorIconsQuery,
  type PublicCreatorProfile,
} from '@turkistan/types';
import type { Creator, Icon } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class CreatorsService {
  constructor(private readonly prisma: PrismaService) {}

  // ---- Public ----

  async getPublicProfile(slug: string): Promise<PublicCreatorProfile> {
    const creator = await this.prisma.creator.findUnique({ where: { slug } });
    if (!creator) throw new NotFoundException(`Creator "${slug}" not found`);
    const iconCount = await this.publishedIconCount(creator.id);
    return this.toProfile(creator, iconCount);
  }

  async list(limit: number): Promise<PublicCreatorProfile[]> {
    const creators = await this.prisma.creator.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    if (creators.length === 0) return [];
    const grouped = await this.prisma.icon.groupBy({
      by: ['creatorId'],
      where: {
        creatorId: { in: creators.map((c) => c.id) },
        status: 'PUBLISHED',
        deletedAt: null,
      },
      _count: { _all: true },
    });
    const countByCreator = new Map(grouped.map((g) => [g.creatorId, g._count._all]));
    return creators.map((c) => this.toProfile(c, countByCreator.get(c.id) ?? 0));
  }

  // ---- Creator self-service (dashboard shell) ----

  async getDashboard(userId: string): Promise<CreatorDashboard> {
    const creator = await this.requireCreator(userId);
    const grouped = await this.prisma.icon.groupBy({
      by: ['status'],
      where: { creatorId: creator.id, deletedAt: null },
      _count: { _all: true },
    });

    const statusCounts = this.emptyStatusCounts();
    for (const row of grouped) statusCounts[row.status] = row._count._all;
    const iconCount = Object.values(statusCounts).reduce((sum, n) => sum + n, 0);

    return {
      creator: { id: creator.id, slug: creator.slug, displayName: creator.displayName },
      statusCounts,
      totals: {
        iconCount,
        // Placeholders until download (M8) and payment (M10) pipelines land.
        downloads: creator.totalDownloads,
        revenueCents: Number(creator.totalRevenueCents),
        currency: 'USD',
      },
    };
  }

  async listOwnIcons(
    userId: string,
    query: ListCreatorIconsQuery,
  ): Promise<CreatorIconSummary[]> {
    const creator = await this.requireCreator(userId);
    const icons = await this.prisma.icon.findMany({
      where: {
        creatorId: creator.id,
        deletedAt: null,
        ...(query.status ? { status: query.status } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: query.limit,
    });
    return icons.map((icon) => this.toIconSummary(icon));
  }

  // ---- internals ----

  private async requireCreator(userId: string): Promise<Creator> {
    const creator = await this.prisma.creator.findUnique({ where: { userId } });
    if (!creator) throw new NotFoundException('You do not have a creator profile');
    return creator;
  }

  private publishedIconCount(creatorId: string): Promise<number> {
    return this.prisma.icon.count({
      where: { creatorId, status: 'PUBLISHED', deletedAt: null },
    });
  }

  private emptyStatusCounts(): Record<IconStatus, number> {
    return Object.fromEntries(ICON_STATUSES.map((s) => [s, 0])) as Record<IconStatus, number>;
  }

  private toProfile(creator: Creator, iconCount: number): PublicCreatorProfile {
    return {
      id: creator.id,
      slug: creator.slug,
      displayName: creator.displayName,
      bio: creator.bio,
      website: creator.website,
      country: creator.country,
      totalDownloads: creator.totalDownloads,
      iconCount,
      createdAt: creator.createdAt.toISOString(),
    };
  }

  private toIconSummary(icon: Icon): CreatorIconSummary {
    return {
      id: icon.id,
      name: icon.name,
      slug: icon.slug,
      status: icon.status,
      priceType: icon.priceType,
      downloadCount: icon.downloadCount,
      createdAt: icon.createdAt.toISOString(),
    };
  }
}
