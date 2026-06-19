import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  CreateTagInput,
  ListTagsQuery,
  TagDto,
  UpdateTagInput,
} from '@turkistan/types';
import type { Prisma, Tag } from '@prisma/client';
import { slugify } from '../../common/util/slug.util';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class TagsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListTagsQuery): Promise<TagDto[]> {
    // `name` is citext, so prefix matching is already case-insensitive.
    const where: Prisma.TagWhereInput = query.q ? { name: { startsWith: query.q } } : {};
    const orderBy: Prisma.TagOrderByWithRelationInput[] =
      query.sort === 'name'
        ? [{ name: 'asc' }]
        : [{ usageCount: 'desc' }, { name: 'asc' }];
    const tags = await this.prisma.tag.findMany({ where, orderBy, take: query.limit });
    return tags.map((tag) => this.toDto(tag));
  }

  async create(dto: CreateTagInput): Promise<TagDto> {
    await this.assertNameFree(dto.name);
    const slug = await this.uniqueSlug(slugify(dto.name));
    const tag = await this.prisma.tag.create({ data: { name: dto.name, slug } });
    return this.toDto(tag);
  }

  async update(id: string, dto: UpdateTagInput): Promise<TagDto> {
    const existing = await this.prisma.tag.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Tag not found');
    await this.assertNameFree(dto.name, id);
    // Slug stays stable across renames so existing URLs keep resolving.
    const tag = await this.prisma.tag.update({ where: { id }, data: { name: dto.name } });
    return this.toDto(tag);
  }

  async remove(id: string): Promise<void> {
    const existing = await this.prisma.tag.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Tag not found');
    // icon_tags rows cascade (FK onDelete: Cascade).
    await this.prisma.tag.delete({ where: { id } });
  }

  private async assertNameFree(name: string, exceptId?: string): Promise<void> {
    const clash = await this.prisma.tag.findFirst({
      where: { name, ...(exceptId ? { id: { not: exceptId } } : {}) },
      select: { id: true },
    });
    if (clash) throw new ConflictException(`A tag named "${name}" already exists`);
  }

  private async uniqueSlug(base: string): Promise<string> {
    let candidate = base;
    let suffix = 2;
    while ((await this.prisma.tag.count({ where: { slug: candidate } })) > 0) {
      candidate = `${base}-${suffix++}`;
    }
    return candidate;
  }

  private toDto(tag: Tag): TagDto {
    return { id: tag.id, name: tag.name, slug: tag.slug, usageCount: tag.usageCount };
  }
}
