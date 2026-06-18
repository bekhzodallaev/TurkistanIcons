import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  MAX_SVG_UPLOAD_BYTES,
  type UploadInitInput,
  type UploadInitResponse,
  type UploadStatusDto,
} from '@turkistan/types';
import { randomUUID } from 'node:crypto';
import { slugify } from '../../common/util/slug.util';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { R2Service } from '../../storage/r2.service';
import { IconStateService } from '../icons/icon-state.service';
import { IconProcessingProducer } from './icon-processing.producer';

const SIGNED_PUT_TTL_SECONDS = 300; // 5 min
const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;

@Injectable()
export class UploadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly r2: R2Service,
    private readonly icons: IconStateService,
    private readonly producer: IconProcessingProducer,
  ) {}

  async init(
    userId: string,
    dto: UploadInitInput,
    idempotencyKey: string,
  ): Promise<UploadInitResponse> {
    if (!this.r2.isConfigured()) {
      throw new ServiceUnavailableException('Uploads are temporarily unavailable');
    }
    const creator = await this.prisma.creator.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!creator) throw new ForbiddenException('Only creators can upload icons');

    const idemKey = `upload:init:${creator.id}:${idempotencyKey}`;
    const cached = await this.readIdempotent(idemKey);
    if (cached) return cached;

    await this.assertCategoryExists(dto.categoryId);
    const tagIds = await this.resolveTags(dto.tags);
    const slug = await this.uniqueIconSlug(creator.id, slugify(dto.name));

    const icon = await this.icons.createDraft({
      creatorId: creator.id,
      name: dto.name,
      slug,
      categoryId: dto.categoryId,
      priceType: dto.priceType,
      priceCents: dto.priceCents,
      license: dto.license,
      // Filled below once we know the icon id.
      svgRawKey: '',
      tagIds,
    });

    const rawKey = `quarantine/${creator.id}/${icon.id}/${randomUUID()}.svg`;
    await this.prisma.icon.update({ where: { id: icon.id }, data: { svgRawKey: rawKey } });

    const url = await this.r2.signRawUploadUrl(rawKey, dto.contentType, SIGNED_PUT_TTL_SECONDS);

    const response: UploadInitResponse = {
      icon: { id: icon.id, status: 'DRAFT', slug },
      upload: {
        url,
        method: 'PUT',
        headers: { 'Content-Type': dto.contentType },
        maxBytes: MAX_SVG_UPLOAD_BYTES,
        expiresIn: SIGNED_PUT_TTL_SECONDS,
      },
    };
    await this.writeIdempotent(idemKey, response);
    return response;
  }

  async finalize(iconId: string, userId: string): Promise<{ id: string; status: string }> {
    const icon = await this.icons.findOwned(iconId, userId);
    if (icon.status !== 'DRAFT') {
      // Idempotent: already finalized/processed.
      return { id: icon.id, status: icon.status };
    }
    if (!icon.svgRawKey) throw new ConflictException('upload_not_found');

    const head = await this.r2.headRaw(icon.svgRawKey);
    if (!head) throw new ConflictException('upload_not_found');

    await this.icons.transition(iconId, 'DRAFT', 'PROCESSING', { fileSize: head.size });
    await this.producer.enqueue({ iconId, rawKey: icon.svgRawKey, creatorId: icon.creatorId });

    return { id: iconId, status: 'PROCESSING' };
  }

  async status(iconId: string, userId: string): Promise<UploadStatusDto> {
    const icon = await this.icons.findOwned(iconId, userId);
    return {
      id: icon.id,
      status: icon.status,
      checksum: icon.checksum ? `sha256:${icon.checksum}` : null,
      previewUrl: icon.pngKey ? this.r2.publicUrl(icon.pngKey) : null,
      rejectionReason: icon.rejectionReason,
    };
  }

  // ---- internals ----

  private async assertCategoryExists(categoryId: string): Promise<void> {
    const count = await this.prisma.category.count({ where: { id: categoryId } });
    if (count === 0) throw new BadRequestException('Unknown category');
  }

  /** Connect to existing tags by slug, creating any that don't exist yet. */
  private async resolveTags(tags: string[]): Promise<string[]> {
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const raw of tags) {
      const slug = slugify(raw);
      if (seen.has(slug)) continue;
      seen.add(slug);
      const existing = await this.prisma.tag.findUnique({ where: { slug } });
      const tag = existing ?? (await this.prisma.tag.create({ data: { name: raw, slug } }));
      ids.push(tag.id);
    }
    return ids;
  }

  private async uniqueIconSlug(creatorId: string, base: string): Promise<string> {
    let candidate = base;
    let suffix = 2;
    while (
      (await this.prisma.icon.count({ where: { creatorId, slug: candidate } })) > 0
    ) {
      candidate = `${base}-${suffix++}`;
    }
    return candidate;
  }

  private async readIdempotent(key: string): Promise<UploadInitResponse | null> {
    try {
      return await this.redis.cacheGetJson<UploadInitResponse>(key);
    } catch {
      return null; // fail open: proceed without idempotency if Redis is down
    }
  }

  private async writeIdempotent(key: string, value: UploadInitResponse): Promise<void> {
    try {
      await this.redis.cacheSetJson(key, value, IDEMPOTENCY_TTL_SECONDS);
    } catch {
      // best-effort
    }
  }
}
