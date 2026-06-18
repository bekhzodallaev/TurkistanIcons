import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import type { IconMetadataDto, UpdateIconMetadataInput } from '@turkistan/types';
import type { Prisma } from '@prisma/client';
import { slugify } from '../../common/util/slug.util';
import { PrismaService } from '../../prisma/prisma.service';
import { IconStateService } from './icon-state.service';

// Metadata is editable only before publication.
const EDITABLE_STATUSES = new Set(['DRAFT', 'PENDING_REVIEW']);

@Injectable()
export class IconsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly icons: IconStateService,
  ) {}

  async updateMetadata(
    iconId: string,
    userId: string,
    dto: UpdateIconMetadataInput,
  ): Promise<IconMetadataDto> {
    const icon = await this.icons.findOwned(iconId, userId);
    if (!EDITABLE_STATUSES.has(icon.status)) {
      throw new ConflictException(`Icon cannot be edited while ${icon.status}`);
    }

    const data: Prisma.IconUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name; // slug stays stable
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.priceType !== undefined) data.priceType = dto.priceType;
    if (dto.priceCents !== undefined) data.priceCents = dto.priceCents;
    if (dto.license !== undefined) data.license = dto.license;
    if (dto.categoryId !== undefined) {
      await this.assertCategoryExists(dto.categoryId);
      data.category = { connect: { id: dto.categoryId } };
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      if (dto.tags !== undefined) {
        const tagIds = await this.resolveTags(tx, dto.tags);
        await tx.iconTag.deleteMany({ where: { iconId } });
        if (tagIds.length) {
          await tx.iconTag.createMany({ data: tagIds.map((tagId) => ({ iconId, tagId })) });
        }
      }
      return tx.icon.update({
        where: { id: iconId },
        data,
        include: { iconTags: { include: { tag: { select: { slug: true } } } } },
      });
    });

    return {
      id: updated.id,
      name: updated.name,
      slug: updated.slug,
      description: updated.description,
      status: updated.status,
      categoryId: updated.categoryId,
      priceType: updated.priceType,
      priceCents: updated.priceCents,
      license: updated.license,
      tags: updated.iconTags.map((it) => it.tag.slug),
    };
  }

  private async assertCategoryExists(categoryId: string): Promise<void> {
    const count = await this.prisma.category.count({ where: { id: categoryId } });
    if (count === 0) throw new BadRequestException('Unknown category');
  }

  private async resolveTags(tx: Prisma.TransactionClient, tags: string[]): Promise<string[]> {
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const raw of tags) {
      const slug = slugify(raw);
      if (seen.has(slug)) continue;
      seen.add(slug);
      const existing = await tx.tag.findUnique({ where: { slug } });
      const tag = existing ?? (await tx.tag.create({ data: { name: raw, slug } }));
      ids.push(tag.id);
    }
    return ids;
  }
}
